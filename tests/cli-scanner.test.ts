import { describe, expect, test } from "bun:test";

import type { ExecFileRunner } from "../src/models/cli";
import {
  detectHostAgent,
  getCliVersion,
  getCodexConfigFallback,
  getUnixClaudeVersionFallback,
  getWindowsClaudeFallback,
  resolveOnPath,
  scanCodingClis,
} from "../src/scanner/cli-scanner";

describe("CLI scanner", () => {
  test("returns canonical order and isolates unavailable CLIs", async () => {
    const execFile: ExecFileRunner = async (file, args) => {
      if (file === "which") {
        if (args[0] === "codex") {
          return { stdout: "/opt/bin/codex\n", stderr: "" };
        }
        if (args[0] === "omp") {
          return { stdout: "/opt/bin/omp\n", stderr: "" };
        }
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      }

      if (file === "/opt/bin/codex" && args[0] === "--version") {
        return { stdout: "codex-cli 0.139.0\n", stderr: "" };
      }
      throw Object.assign(new Error("failed"), { code: 1 });
    };

    const installed = new Set(["/opt/bin/codex", "/opt/bin/omp"]);

    const detected = await scanCodingClis({
      platform: "linux",
      execFile,
      access: async (candidate) => {
        if (!installed.has(candidate)) {
          throw Object.assign(new Error("not found"), { code: "ENOENT" });
        }
      },
      env: {},
      homeDir: "/home/tester",
    });

    expect(detected.map((cli) => cli.id)).toEqual(["codex", "claude", "pi", "omp"]);
    expect(detected[0]).toMatchObject({
      available: true,
      path: "/opt/bin/codex",
      version: "codex-cli 0.139.0",
    });
    expect(detected[1]).toMatchObject({
      available: false,
      path: "",
      version: null,
    });
    expect(detected[2]).toMatchObject({ available: false });
    expect(detected[3]).toMatchObject({
      available: true,
      path: "/opt/bin/omp",
      version: null,
    });
  });

  test("falls back through version flags and takes the first non-empty line", async () => {
    const calls: string[][] = [];
    const execFile: ExecFileRunner = async (_file, args) => {
      calls.push([...args]);
      if (args[0] === "--version") {
        throw Object.assign(new Error("unsupported"), { code: 1 });
      }
      if (args[0] === "-v") {
        return {
          stdout: "",
          stderr: "  pi 1.2.3  \nsecond line\n",
        };
      }
      throw new Error("unexpected version flag");
    };

    const version = await getCliVersion("/opt/bin/pi", {
      execFile,
      platform: "linux",
      env: {},
      homeDir: "/home/tester",
      versionTimeoutMs: 50,
    });

    expect(version).toBe("pi 1.2.3");
    expect(calls).toEqual([["--version"], ["-v"]]);
  });

  test("uses where and takes its first non-empty path", async () => {
    const execFile: ExecFileRunner = async (file, args) => {
      expect(file).toBe("where");
      expect(args).toEqual(["codex"]);
      return {
        stdout: "\r\nC:\\Program Files\\Codex\\codex.exe\r\nC:\\Other\\codex.exe\r\n",
        stderr: "",
      };
    };

    await expect(
      resolveOnPath("codex", {
        platform: "win32",
        execFile,
        env: {},
        homeDir: "C:\\Users\\tester",
      }),
    ).resolves.toBe("C:\\Program Files\\Codex\\codex.exe");
  });

  test("checks Claude Windows fallbacks in documented order", async () => {
    const checked: string[] = [];
    const fallback = await getWindowsClaudeFallback({
      platform: "win32",
      homeDir: "C:\\Users\\tester",
      env: { APPDATA: "C:\\Users\\tester\\AppData\\Roaming" },
      access: async (candidate) => {
        checked.push(candidate);
        if (checked.length === 1) {
          throw new Error("missing");
        }
      },
    });

    expect(checked).toEqual([
      "C:\\Users\\tester\\.local\\bin\\claude.exe",
      "C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd",
    ]);
    expect(fallback).toBe("C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd");
  });

  test("detects only documented host markers", () => {
    expect(detectHostAgent({ CLAUDECODE: "1" })).toBe("claude");
    expect(detectHostAgent({ CLAUDE_CODE_CHILD_SESSION: "1" })).toBe("claude");
    expect(detectHostAgent({ PI_CODING_AGENT: "true" })).toBe("pi");
    expect(detectHostAgent({ PI_CODING_AGENT: "1" })).toBe("pi");
    expect(detectHostAgent({ PI_CODING_AGENT: "yes" })).toBeNull();
    expect(detectHostAgent({})).toBeNull();
  });

  test("extracts CODEX_CLI_PATH from process/env override", async () => {
    const accessible = new Set(["/custom/bin/codex"]);
    const fallback = await getCodexConfigFallback({
      platform: "linux",
      homeDir: "/home/tester",
      env: { CODEX_CLI_PATH: "/custom/bin/codex" },
      access: async (candidate) => {
        if (!accessible.has(candidate)) {
          throw new Error("not found");
        }
      },
    });

    expect(fallback).toBe("/custom/bin/codex");
  });

  test("throws when CODEX_CLI_PATH does not exist or is not executable", async () => {
    await expect(
      getCodexConfigFallback({
        platform: "linux",
        homeDir: "/home/tester",
        env: { CODEX_CLI_PATH: "/custom/bin/missing" },
        access: async () => {
          throw new Error("not found");
        },
      }),
    ).rejects.toThrow(
      'invalid CODEX_CLI_PATH: "/custom/bin/missing" does not exist or is not executable',
    );
  });

  test("does not treat CODEX_CLI_PATH as a toml config key", async () => {
    let readFileCalled = false;
    const fallback = await getCodexConfigFallback({
      platform: "linux",
      homeDir: "/home/tester",
      env: {},
      readFile: async () => {
        readFileCalled = true;
        return 'CODEX_CLI_PATH = "/custom/bin/codex"\n';
      },
      access: async () => {},
    });

    expect(fallback).toBeNull();
    expect(readFileCalled).toBe(false);
  });

  test("falls back to macOS ChatGPT app bundle when CODEX_CLI_PATH is not set", async () => {
    const accessible = new Set(["/Applications/ChatGPT.app/Contents/Resources/codex"]);
    const fallback = await getCodexConfigFallback({
      platform: "darwin",
      homeDir: "/Users/tester",
      env: {},
      access: async (candidate) => {
        if (!accessible.has(candidate)) {
          throw new Error("not found");
        }
      },
    });

    expect(fallback).toBe("/Applications/ChatGPT.app/Contents/Resources/codex");
  });

  test("probes latest Claude version from ~/.local/share/claude/versions on Unix", async () => {
    const accessible = new Set([
      "/home/tester/.local/share/claude/versions/2.1.275",
      "/home/tester/.local/share/claude/versions/2.1.278",
    ]);

    const fallback = await getUnixClaudeVersionFallback({
      platform: "linux",
      homeDir: "/home/tester",
      readdir: async (dirPath) => {
        if (dirPath === "/home/tester/.local/share/claude/versions") {
          return ["2.1.275", "2.1.278", "2.1.270"];
        }
        throw new Error("dir not found");
      },
      access: async (candidate) => {
        if (!accessible.has(candidate)) {
          throw new Error("inaccessible");
        }
      },
    });

    expect(fallback).toBe("/home/tester/.local/share/claude/versions/2.1.278");
  });

  test("scans codex via CODEX_CLI_PATH and claude from version dir when missing from PATH", async () => {
    const execFile: ExecFileRunner = async (file, args) => {
      if (file === "which") {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      }
      if (file === "/opt/custom/codex" && args[0] === "--version") {
        return { stdout: "codex-cli 0.155.0\n", stderr: "" };
      }
      if (file === "/home/tester/.local/share/claude/versions/2.1.278" && args[0] === "--version") {
        return { stdout: "2.1.278\n", stderr: "" };
      }
      throw Object.assign(new Error("failed"), { code: 1 });
    };

    const installed = new Set([
      "/opt/custom/codex",
      "/home/tester/.local/share/claude/versions/2.1.278",
    ]);

    const detected = await scanCodingClis({
      platform: "linux",
      execFile,
      access: async (candidate) => {
        if (!installed.has(candidate)) {
          throw Object.assign(new Error("not found"), { code: "ENOENT" });
        }
      },
      readdir: async (dir) => {
        if (dir === "/home/tester/.local/share/claude/versions") {
          return ["2.1.278"];
        }
        throw new Error("not found");
      },
      env: {
        CODEX_CLI_PATH: "/opt/custom/codex",
      },
      homeDir: "/home/tester",
    });

    const codex = detected.find((cli) => cli.id === "codex");
    const claude = detected.find((cli) => cli.id === "claude");

    expect(codex).toMatchObject({
      available: true,
      path: "/opt/custom/codex",
      source: "installer",
      version: "codex-cli 0.155.0",
    });
    expect(claude).toMatchObject({
      available: true,
      path: "/home/tester/.local/share/claude/versions/2.1.278",
      source: "installer",
      version: "2.1.278",
    });
  });
});
