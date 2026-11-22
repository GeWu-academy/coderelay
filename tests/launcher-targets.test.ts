import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import type { ChildProcess } from "node:child_process";
import { createCliAdapters } from "../src/agents/cli-adapters";
import type { LaunchTarget } from "../src/models/cli";
import {
  buildLaunchArgv,
  buildLaunchCmd,
  createSpawnOptions,
  launchInteractive,
  launchWithPrompt,
  launchWithPromptCaptured,
  resolveLaunchCwd,
  runOnce,
} from "../src/runtime/launcher";

const adapters = createCliAdapters({ homeDir: "/home/tester", env: {} });

const LOCAL_TARGET: LaunchTarget = {
  path: "C:\\Program Files\\Codex\\codex.exe",
  runtime: "local",
};

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

describe("buildLaunchArgv", () => {
  test("uses the scanned path verbatim, spaces and all", () => {
    expect(buildLaunchArgv(LOCAL_TARGET, ["-p", "hi"])).toEqual({
      file: "C:\\Program Files\\Codex\\codex.exe",
      args: ["-p", "hi"],
    });
  });

  test("buildLaunchCmd prefixes the executable for cmd[]-style runtimes", () => {
    expect(buildLaunchCmd(LOCAL_TARGET, ["exec"])).toEqual([
      "C:\\Program Files\\Codex\\codex.exe",
      "exec",
    ]);
  });
});

describe("resolveLaunchCwd", () => {
  test("leaves a local working directory alone", () => {
    expect(resolveLaunchCwd("C:\\work", LOCAL_TARGET)).toBe("C:\\work");
    expect(resolveLaunchCwd("/work", undefined)).toBe("/work");
    expect(resolveLaunchCwd(undefined, LOCAL_TARGET)).toBeUndefined();
  });
});

describe("createSpawnOptions", () => {
  test("uses shell and windowsHide on Windows for local targets", () => {
    const local = createSpawnOptions({ cwd: "C:\\tmp", target: LOCAL_TARGET }, "win32");

    expect(local).toMatchObject({ shell: true, windowsHide: true, cwd: "C:\\tmp" });
  });
});

describe("launch entry points honour the scanned runtime", () => {
  test("interactive launch of a local target uses its scanned path", () => {
    let launched: { file: string; args: readonly string[] } | undefined;

    launchInteractive(adapters.codex, {
      target: LOCAL_TARGET,
      extraArgs: ["--json"],
      dependencies: {
        platform: "win32",
        spawn: (file, args) => {
          launched = { file, args };
          return {} as ChildProcess;
        },
      },
    });

    expect(launched).toEqual({
      file: "C:\\Program Files\\Codex\\codex.exe",
      args: ["--json"],
    });
  });

  test("prompt launch of a local target keeps the adapter's prompt args", () => {
    let launched: { file: string; args: readonly string[] } | undefined;

    launchWithPrompt(adapters.omp, "do work", {
      target: { path: "/usr/bin/omp", runtime: "local" },
      dependencies: {
        platform: "linux",
        spawn: (file, args) => {
          launched = { file, args };
          return {} as ChildProcess;
        },
      },
    });

    expect(launched).toEqual({
      file: "/usr/bin/omp",
      args: ["-p", "do work"],
    });
  });

  test("captured prompt launch uses the same argv as the interactive path", async () => {
    const child = fakeChild();
    let launched: { file: string; args: readonly string[] } | undefined;

    const handle = launchWithPromptCaptured(adapters.pi, "do work", {
      target: LOCAL_TARGET,
      dependencies: {
        platform: "win32",
        spawn: (file, args) => {
          launched = { file, args };
          return child;
        },
      },
    });
    child.emit("close", 0, null);
    await handle.done;

    expect(launched).toEqual({
      file: "C:\\Program Files\\Codex\\codex.exe",
      args: ["-p", "do work"],
    });
  });

  test("a launch without a target still runs the given path directly", () => {
    let launched: { file: string; args: readonly string[] } | undefined;

    launchInteractive("/opt/bin/codex", {
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

  test("runOnce executes a local target directly", async () => {
    let executed: { file: string; args: readonly string[] } | undefined;

    await runOnce("/opt/bin/codex", ["exec", "hi"], {
      target: LOCAL_TARGET,
      cwd: "C:\\Users\\me\\project",
      dependencies: {
        platform: "win32",
        execFile: async (file, args, options) => {
          executed = { file, args };
          expect(options?.shell).toBe(true);
          expect(options?.cwd).toBe("C:\\Users\\me\\project");
          return { stdout: "", stderr: "" };
        },
      },
    });

    expect(executed).toEqual({
      file: "C:\\Program Files\\Codex\\codex.exe",
      args: ["exec", "hi"],
    });
  });
});
