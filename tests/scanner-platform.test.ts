import { describe, expect, test } from "bun:test";

import { cliCandidates, cliSource, type ExecFileRunner } from "../src/models/cli";
import { scanCodingClis, type ScannerOptions } from "../src/scanner/cli-scanner";

/** A fake host: which commands answer, which files exist, which versions print. */
interface FakeHost {
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Exact stdout per `file arg1 arg2` command line. Anything else throws. */
  readonly outputs?: Readonly<Record<string, string>>;
  /** Exact file paths the access check accepts. */
  readonly files?: readonly string[];
}

function scannerOptionsFor(host: FakeHost): ScannerOptions {
  const outputs = host.outputs ?? {};
  const files = new Set(host.files ?? []);
  const calls: string[] = [];

  const execFile: ExecFileRunner = async (file, args) => {
    const command = [file, ...args].join(" ");
    calls.push(command);
    const stdout = outputs[command];
    if (stdout === undefined) {
      throw Object.assign(new Error(`no such command: ${command}`), {
        code: "ENOENT",
      });
    }
    return { stdout, stderr: "" };
  };

  return {
    platform: host.platform,
    homeDir: host.homeDir,
    env: host.env ?? {},
    execFile,
    access: async (candidate) => {
      if (!files.has(candidate)) {
        throw Object.assign(new Error(`missing: ${candidate}`), {
          code: "ENOENT",
        });
      }
    },
  };
}

async function scan(host: FakeHost) {
  return scanCodingClis(scannerOptionsFor(host));
}

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  return nth(items, 0);
}

/** Canonical order is part of the contract, so index access is deliberate. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`expected a CLI at index ${index}`);
  }
  return item;
}

describe("Windows native resolution", () => {
  test("where reports every match; the first is selected and the rest stay candidates", async () => {
    const detected = await scan({
      platform: "win32",
      homeDir: "C:\\Users\\tester",
      env: { PATH: "C:\\Program Files\\Codex;C:\\Other" },
      files: ["C:\\Program Files\\Codex\\codex.exe", "C:\\Other\\codex.exe"],
      outputs: {
        "where codex":
          "\r\nC:\\Program Files\\Codex\\codex.exe\r\nC:\\Other\\codex.exe\r\n",
        "C:\\Program Files\\Codex\\codex.exe --version":
          "codex-cli 0.139.0\r\n",
        "C:\\Other\\codex.exe --version": "codex-cli 0.130.0\r\n",
      },
    });

    const codex = nth(detected, 0);
    expect(codex).toMatchObject({
      available: true,
      path: "C:\\Program Files\\Codex\\codex.exe",
      version: "codex-cli 0.139.0",
      runtime: "local",
    });
    expect(cliCandidates(codex).map((candidate) => candidate.path)).toEqual([
      "C:\\Program Files\\Codex\\codex.exe",
      "C:\\Other\\codex.exe",
    ]);
    expect(cliCandidates(codex).every((candidate) => candidate.runtime === "local")).toBe(true);
  });

  test("a PATHEXT shim wins over the extensionless name in the npm directory", async () => {
    const detected = await scan({
      platform: "win32",
      homeDir: "C:\\Users\\tester",
      env: {
        PATH: "C:\\Windows",
        PATHEXT: ".CMD;.EXE",
        APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
      },
      files: ["C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd"],
      outputs: {
        "C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd --version":
          "2.0.1 (Claude Code)\r\n",
      },
    });

    const claude = nth(detected, 1);
    expect(claude).toMatchObject({
      available: true,
      path: "C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd",
      version: "2.0.1 (Claude Code)",
    });
    // Found by directory scan, not by `where`: it is not on this shell's PATH.
    expect(cliSource(claude)).toBe("npm");
    expect(claude.diagnostics?.map((entry) => entry.message).join("\n")).toContain(
      "已安装但不在当前 PATH",
    );
  });

  test("a missing PATHEXT still finds the batch shim through the default list", async () => {
    const detected = await scan({
      platform: "win32",
      homeDir: "C:\\Users\\tester",
      env: {
        PATH: "C:\\Windows",
        APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
      },
      files: ["C:\\Users\\tester\\AppData\\Roaming\\npm\\omp.cmd"],
      outputs: {
        "C:\\Users\\tester\\AppData\\Roaming\\npm\\omp.cmd --version":
          "omp 0.9.0\r\n",
      },
    });

    expect(nth(detected, 3)).toMatchObject({
      available: true,
      path: "C:\\Users\\tester\\AppData\\Roaming\\npm\\omp.cmd",
      version: "omp 0.9.0",
    });
  });

  test("the winget Links directory is searched when LOCALAPPDATA is set", async () => {
    const detected = await scan({
      platform: "win32",
      homeDir: "C:\\Users\\tester",
      env: {
        PATH: "C:\\Windows",
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
      },
      files: [
        "C:\\Users\\tester\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe",
      ],
      outputs: {
        "C:\\Users\\tester\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe --version":
          "2.0.1\r\n",
      },
    });

    expect(nth(detected, 1)).toMatchObject({ available: true });
    expect(cliSource(nth(detected, 1))).toBe("winget");
  });
});

describe("macOS resolution", () => {
  test("Apple Silicon Homebrew prefix is not inferred from the file name", async () => {
    const detected = await scan({
      platform: "darwin",
      homeDir: "/Users/tester",
      env: { PATH: "/usr/bin:/opt/homebrew/bin" },
      files: ["/opt/homebrew/bin/omp"],
      outputs: {
        "which omp": "/opt/homebrew/bin/omp\n",
        "brew --prefix": "/opt/homebrew\n",
        "/opt/homebrew/bin/omp --version": "omp 0.9.0\n",
      },
    });

    const omp = nth(detected, 3);
    expect(omp).toMatchObject({
      available: true,
      path: "/opt/homebrew/bin/omp",
      version: "omp 0.9.0",
    });
    expect(cliSource(omp)).toBe("brew");
  });

  test("Intel Homebrew prefix is found the same way", async () => {
    const detected = await scan({
      platform: "darwin",
      homeDir: "/Users/tester",
      env: { PATH: "/usr/bin:/usr/local/bin" },
      files: ["/usr/local/bin/codex"],
      outputs: {
        "which codex": "/usr/local/bin/codex\n",
        "brew --prefix": "/usr/local\n",
        "/usr/local/bin/codex --version": "codex-cli 0.139.0\n",
      },
    });

    expect(nth(detected, 0)).toMatchObject({
      available: true,
      path: "/usr/local/bin/codex",
    });
    expect(cliSource(nth(detected, 0))).toBe("brew");
  });

  test("the per-user installer directory is preferred to a later system one", async () => {
    const detected = await scan({
      platform: "darwin",
      homeDir: "/Users/tester",
      env: { PATH: "/usr/bin" },
      files: [
        "/Users/tester/.local/bin/codex",
        "/Users/tester/.bun/bin/codex",
      ],
      outputs: {
        "/Users/tester/.local/bin/codex --version": "codex-cli 0.139.0\n",
        "/Users/tester/.bun/bin/codex --version": "codex-cli 0.120.0\n",
      },
    });

    expect(nth(detected, 0)).toMatchObject({
      path: "/Users/tester/.local/bin/codex",
    });
    expect(cliSource(nth(detected, 0))).toBe("installer");
    expect(cliCandidates(nth(detected, 0)).map((candidate) => candidate.path)).toEqual([
      "/Users/tester/.local/bin/codex",
      "/Users/tester/.bun/bin/codex",
    ]);
  });
});

describe("resolution without a usable PATH", () => {
  test("an empty PATH still finds the CLI in the package manager's global bin", async () => {
    const detected = await scan({
      platform: "linux",
      homeDir: "/home/tester",
      env: { PATH: "" },
      files: ["/usr/local/bin/codex"],
      outputs: {
        "npm prefix -g": "/usr/local\n",
        "/usr/local/bin/codex --version": "codex-cli 0.139.0\n",
      },
    });

    expect(nth(detected, 0)).toMatchObject({
      available: true,
      path: "/usr/local/bin/codex",
      version: "codex-cli 0.139.0",
    });
    expect(cliSource(nth(detected, 0))).toBe("npm");
  });

  test("a dead PATH hit does not stop the scan from finding the live one", async () => {
    const detected = await scan({
      platform: "linux",
      homeDir: "/home/tester",
      env: { PATH: "/opt/bin" },
      files: ["/usr/local/bin/codex"],
      outputs: {
        "which codex": "/opt/bin/codex\n",
        "npm prefix -g": "/usr/local\n",
        "/usr/local/bin/codex --version": "codex-cli 0.139.0\n",
      },
    });

    expect(nth(detected, 0)).toMatchObject({
      available: true,
      path: "/usr/local/bin/codex",
    });
    expect(cliCandidates(nth(detected, 0)).map((candidate) => candidate.path)).toEqual([
      "/usr/local/bin/codex",
    ]);
  });

  test("a CLI found nowhere is reported unavailable with the searched directories", async () => {
    const detected = await scan({
      platform: "linux",
      homeDir: "/home/tester",
      env: { PATH: "/usr/bin" },
    });

    const claude = nth(detected, 1);
    expect(claude).toMatchObject({ available: false, path: "", version: null });
    const messages = claude.diagnostics?.map((entry) => entry.message) ?? [];
    expect(messages[0]).toContain("未发现 claude");
    expect(messages[0]).toContain("/home/tester/.local/bin");
    expect(messages[0]).toContain("/home/tester/.nix-profile/bin");
    expect(cliCandidates(claude)).toEqual([]);
  });
});

describe("version probing", () => {
  test("an empty version output falls through the flags and ends as null", async () => {
    const detected = await scan({
      platform: "linux",
      homeDir: "/home/tester",
      env: { PATH: "/opt/bin" },
      files: ["/opt/bin/omp"],
      outputs: {
        "which omp": "/opt/bin/omp\n",
        "/opt/bin/omp --version": "\n",
        "/opt/bin/omp -v": "   \n",
        "/opt/bin/omp -V": "\n",
      },
    });

    const omp = nth(detected, 3);
    expect(omp).toMatchObject({ available: true, version: null });
    expect(omp.diagnostics?.map((entry) => entry.message).join("\n")).toContain(
      "版本探测失败",
    );
  });

  test("a version reported on stderr is accepted", async () => {
    const detected = await scanCodingClis({
      platform: "linux",
      homeDir: "/home/tester",
      env: { PATH: "/opt/bin" },
      execFile: async (file, args) => {
        const command = [file, ...args].join(" ");
        if (command === "which pi") {
          return { stdout: "/opt/bin/pi\n", stderr: "" };
        }
        if (command === "/opt/bin/pi --version") {
          return { stdout: "", stderr: "pi 1.2.3\n" };
        }
        throw Object.assign(new Error(command), { code: "ENOENT" });
      },
      access: async (candidate) => {
        if (candidate !== "/opt/bin/pi") {
          throw new Error("missing");
        }
      },
    });

    expect(nth(detected, 2)).toMatchObject({
      available: true,
      version: "pi 1.2.3",
    });
  });

  test("every launchable candidate carries its own version", async () => {
    const detected = await scan({
      platform: "linux",
      homeDir: "/home/tester",
      env: { PATH: "/opt/bin" },
      files: ["/opt/bin/codex", "/usr/local/bin/codex"],
      outputs: {
        "which codex": "/opt/bin/codex\n",
        "npm prefix -g": "/usr/local\n",
        "/opt/bin/codex --version": "codex-cli 0.139.0\n",
        "/usr/local/bin/codex --version": "codex-cli 0.130.0\n",
      },
    });

    expect(
      cliCandidates(nth(detected, 0)).map((candidate) => candidate.version),
    ).toEqual(["codex-cli 0.139.0", "codex-cli 0.130.0"]);
  });

  test("a broken candidate does not abort the scan of the others", async () => {
    const detected = await scan({
      platform: "linux",
      homeDir: "/home/tester",
      env: { PATH: "/opt/bin" },
      files: ["/opt/bin/codex"],
      outputs: { "which codex": "/opt/bin/codex\n" },
    });

    // Every version flag throws for this path; the CLI is still usable.
    expect(nth(detected, 0)).toMatchObject({ available: true, path: "/opt/bin/codex" });
    expect(only(cliCandidates(nth(detected, 0))).version).toBeNull();
  });
});
