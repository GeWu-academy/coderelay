import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import type { ChildProcess } from "node:child_process";
import { createCliAdapters } from "../src/agents/cli-adapters";
import {
  buildPromptArgs,
  CliProcessError,
  createSpawnOptions,
  launchInteractive,
  launchWithPromptCaptured,
  runOnce,
} from "../src/runtime/launcher";

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

describe("CLI launcher", () => {
  test("builds prompt args from adapters and appends extra args", () => {
    const adapters = createCliAdapters({ homeDir: "/home/tester", env: {} });

    expect(buildPromptArgs(adapters.codex, "do work")).toEqual(["exec", "do work"]);
    expect(buildPromptArgs(adapters.claude, "do work", ["--json"])).toEqual([
      "-p",
      "do work",
      "--json",
    ]);
    expect(buildPromptArgs(adapters.pi, "do work")).toEqual(["-p", "do work"]);
    expect(buildPromptArgs(adapters.omp, "do work")).toEqual(["-p", "do work"]);
  });

  test("creates inherited stdio options and uses shell on Windows", () => {
    const env = { PATH: "/bin" };
    const unix = createSpawnOptions({ cwd: "/tmp", env }, "linux");
    const windows = createSpawnOptions({ cwd: "C:\\tmp", env }, "win32");

    expect(unix).toMatchObject({
      cwd: "/tmp",
      env,
      stdio: "inherit",
      shell: false,
      windowsHide: false,
    });
    expect(windows).toMatchObject({
      cwd: "C:\\tmp",
      env,
      stdio: "inherit",
      shell: true,
      windowsHide: true,
    });
  });

  test("launches an adapter with the scanned executable path", () => {
    const adapters = createCliAdapters({ homeDir: "/home/tester", env: {} });
    let launched: { file: string; args: readonly string[] } | undefined;

    launchInteractive(adapters.codex, {
      binPath: "/opt/bin/codex",
      extraArgs: ["--json"],
      dependencies: {
        platform: "linux",
        spawn: (file, args) => {
          launched = { file, args };
          return {} as ChildProcess;
        },
      },
    });

    expect(launched).toEqual({ file: "/opt/bin/codex", args: ["--json"] });
  });

  test("launchWithPromptCaptured pipes output and resolves on close", async () => {
    const adapters = createCliAdapters({ homeDir: "/home/tester", env: {} });
    const child = fakeChild();
    let spawned: { file: string; args: readonly string[]; stdio: unknown } | undefined;

    const handle = launchWithPromptCaptured(adapters.claude, "do work", {
      binPath: "/opt/bin/claude",
      dependencies: {
        platform: "linux",
        spawn: (file, args, options) => {
          spawned = { file, args, stdio: options?.stdio };
          return child;
        },
      },
    });

    child.stdout?.emit("data", Buffer.from("partial "));
    child.stdout?.emit("data", "result\n");
    child.stderr?.emit("data", "warn\n");
    child.emit("close", 0, null);

    const result = await handle.done;

    expect(spawned?.file).toBe("/opt/bin/claude");
    expect(spawned?.args).toEqual(["-p", "do work"]);
    expect(spawned?.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(result).toEqual({
      code: 0,
      signal: null,
      stdout: "partial result\n",
      stderr: "warn\n",
    });
  });

  test("launchWithPromptCaptured resolves a null code on spawn error", async () => {
    const adapters = createCliAdapters({ homeDir: "/home/tester", env: {} });
    const child = fakeChild();

    const handle = launchWithPromptCaptured(adapters.codex, "do work", {
      dependencies: {
        platform: "linux",
        spawn: () => child,
      },
    });

    child.emit("error", new Error("spawn ENOENT"));

    const result = await handle.done;

    expect(result).toMatchObject({ code: null, signal: null });
  });

  test("launchWithPromptCaptured keeps only the output tail", async () => {
    const adapters = createCliAdapters({ homeDir: "/home/tester", env: {} });
    const child = fakeChild();

    const handle = launchWithPromptCaptured(adapters.codex, "do work", {
      maxOutputChars: 4,
      dependencies: {
        platform: "linux",
        spawn: () => child,
      },
    });

    child.stdout?.emit("data", "abcdefgh");
    child.emit("close", 0, null);

    const result = await handle.done;

    expect(result.stdout).toBe("efgh");
  });

  test("runOnce returns stdout and stderr on success with documented limits", async () => {
    let capturedTimeout: number | undefined;
    let capturedMaxBuffer: number | undefined;

    const result = await runOnce("codex", ["exec", "hello"], {
      env: { PATH: "/bin" },
      dependencies: {
        platform: "linux",
        execFile: async (_file, _args, options) => {
          capturedTimeout = options?.timeout;
          capturedMaxBuffer = options?.maxBuffer;
          return { stdout: "done\n", stderr: "warning\n" };
        },
      },
    });

    expect(result).toEqual({
      ok: true,
      stdout: "done\n",
      stderr: "warning\n",
      code: 0,
      signal: null,
    });
    expect(capturedTimeout).toBe(120_000);
    expect(capturedMaxBuffer).toBe(10 * 1024 * 1024);
  });

  test("runOnce exposes non-zero exits as CliProcessError", async () => {
    const error = Object.assign(new Error("exit 2"), {
      code: 2,
      signal: null,
      stdout: "partial",
      stderr: "bad input",
    });

    try {
      await runOnce("codex", ["exec", "hello"], {
        dependencies: {
          platform: "linux",
          execFile: async () => {
            throw error;
          },
        },
      });
      throw new Error("runOnce should have rejected");
    } catch (caught) {
      expect(caught).toBeInstanceOf(CliProcessError);
      expect(caught).toMatchObject({
        code: 2,
        stdout: "partial",
        stderr: "bad input",
        timedOut: false,
      });
    }
  });

  test("runOnce identifies timeouts", async () => {
    const timeout = Object.assign(new Error("timed out"), {
      code: "ETIMEDOUT",
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
    });

    try {
      await runOnce("codex", ["exec", "hello"], {
        timeoutMs: 25,
        dependencies: {
          platform: "linux",
          execFile: async () => {
            throw timeout;
          },
        },
      });
      throw new Error("runOnce should have rejected");
    } catch (caught) {
      expect(caught).toBeInstanceOf(CliProcessError);
      expect(caught).toMatchObject({ timedOut: true, signal: "SIGTERM" });
    }
  });
});
