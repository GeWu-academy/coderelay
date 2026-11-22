import { describe, expect, test } from "bun:test";

import {
  candidatePathsInDir,
  classifySource,
  dedupePaths,
  executableNames,
  isDirOnPath,
  pathEntries,
  standardInstallDirs,
  userInstallDirs,
} from "../src/scanner/candidate-paths";

describe("executableNames", () => {
  test("returns the bare name off Windows", () => {
    expect(executableNames("codex", "darwin", { PATHEXT: ".EXE" })).toEqual(["codex"]);
    expect(executableNames("codex", "linux", {})).toEqual(["codex"]);
  });

  test("expands through PATHEXT on Windows, keeping the bare name last", () => {
    expect(executableNames("claude", "win32", { PATHEXT: ".EXE;.CMD" })).toEqual([
      "claude.exe",
      "claude.cmd",
      "claude",
    ]);
  });

  test("falls back to the default PATHEXT when the environment omits it", () => {
    expect(executableNames("claude", "win32", {})).toEqual([
      "claude.com",
      "claude.exe",
      "claude.bat",
      "claude.cmd",
      "claude",
    ]);
  });

  test("accepts extensions declared without a leading dot, case-insensitively", () => {
    expect(executableNames("pi", "win32", { PATHEXT: "EXE;.CMD" })).toEqual([
      "pi.exe",
      "pi.cmd",
      "pi",
    ]);
  });
});

describe("candidatePathsInDir", () => {
  test("joins with the platform separator and tolerates a trailing one", () => {
    expect(candidatePathsInDir("/opt/bin", "codex", "linux", {})).toEqual(["/opt/bin/codex"]);
    expect(candidatePathsInDir("/opt/bin/", "codex", "linux", {})).toEqual(["/opt/bin/codex"]);
    expect(candidatePathsInDir("C:\\npm", "claude", "win32", { PATHEXT: ".CMD" })).toEqual([
      "C:\\npm\\claude.cmd",
      "C:\\npm\\claude",
    ]);
  });
});

describe("install directories", () => {
  test("user installers and Bun share the per-user prefixes", () => {
    expect(userInstallDirs("darwin", "/Users/tester", {})).toEqual([
      { dir: "/Users/tester/.local/bin", source: "installer" },
      { dir: "/Users/tester/.bun/bin", source: "bun" },
    ]);
  });

  test("Windows adds the npm and winget shim directories when APPDATA exists", () => {
    const dirs = userInstallDirs("win32", "C:\\Users\\tester", {
      APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
    });

    expect(dirs).toEqual([
      { dir: "C:\\Users\\tester\\.local\\bin", source: "installer" },
      { dir: "C:\\Users\\tester\\.bun\\bin", source: "bun" },
      { dir: "C:\\Users\\tester\\AppData\\Roaming\\npm", source: "npm" },
      {
        dir: "C:\\Users\\tester\\AppData\\Local\\Microsoft\\WinGet\\Links",
        source: "winget",
      },
    ]);
  });

  test("Windows omits the shim directories when the environment has no APPDATA", () => {
    expect(userInstallDirs("win32", "C:\\Users\\tester", {})).toEqual([
      { dir: "C:\\Users\\tester\\.local\\bin", source: "installer" },
      { dir: "C:\\Users\\tester\\.bun\\bin", source: "bun" },
    ]);
  });

  test("macOS covers both Homebrew prefixes without guessing the architecture", () => {
    expect(standardInstallDirs("darwin", "/Users/tester")).toEqual([
      { dir: "/opt/homebrew/bin", source: "brew" },
      { dir: "/usr/local/bin", source: "brew" },
      { dir: "/Users/tester/.nix-profile/bin", source: "nix" },
      { dir: "/nix/var/nix/profiles/default/bin", source: "nix" },
      { dir: "/Users/tester/.local/share/mise/shims", source: "mise" },
    ]);
  });

  test("Windows has no standard install directory to add", () => {
    expect(standardInstallDirs("win32", "C:\\Users\\tester")).toEqual([]);
  });
});

describe("classifySource", () => {
  const env = {
    APPDATA: "C:\\Users\\tester\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
  };

  test("names the channel for known directories", () => {
    expect(classifySource("/Users/tester/.local/bin/codex", "darwin", "/Users/tester", {})).toBe(
      "installer",
    );
    expect(classifySource("/opt/homebrew/bin/omp", "darwin", "/Users/tester", {})).toBe("brew");
    expect(
      classifySource(
        "C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd",
        "win32",
        "C:\\Users\\tester",
        env,
      ),
    ).toBe("npm");
  });

  test("Windows matching ignores case and separator style", () => {
    expect(
      classifySource(
        "c:/users/tester/appdata/roaming/npm/claude.cmd",
        "win32",
        "C:\\Users\\tester",
        env,
      ),
    ).toBe("npm");
  });

  test("a plain PATH hit is not attributed to any channel", () => {
    expect(classifySource("/usr/bin/codex", "linux", "/home/tester", {})).toBe("path");
    expect(classifySource("/opt/homebrew-ish/bin/omp", "darwin", "/Users/tester", {})).toBe("path");
  });
});

describe("dedupePaths", () => {
  test("keeps the first occurrence and folds case on Windows only", () => {
    expect(dedupePaths(["/a/codex", "/b/codex", "/a/codex"], "linux")).toEqual([
      "/a/codex",
      "/b/codex",
    ]);
    expect(dedupePaths(["C:\\A\\codex.exe", "c:\\a\\CODEX.EXE"], "win32")).toEqual([
      "C:\\A\\codex.exe",
    ]);
    expect(dedupePaths(["/A/codex", "/a/codex"], "linux")).toEqual(["/A/codex", "/a/codex"]);
  });
});

describe("pathEntries / isDirOnPath", () => {
  test("splits on the platform separator", () => {
    expect(pathEntries("linux", { PATH: "/a:/b::/c" })).toEqual(["/a", "/b", "/c"]);
    expect(pathEntries("win32", { PATH: "C:\\a;C:\\b" })).toEqual(["C:\\a", "C:\\b"]);
    expect(pathEntries("linux", {})).toEqual([]);
  });

  test("matches despite trailing separators", () => {
    expect(
      isDirOnPath("/home/tester/.local/bin", "linux", {
        PATH: "/usr/bin:/home/tester/.local/bin/",
      }),
    ).toBe(true);
    expect(
      isDirOnPath("/home/tester/.local/bin", "linux", {
        PATH: "/usr/bin:/home/tester/.local/binx",
      }),
    ).toBe(false);
  });

  test("Windows matches case-insensitively in either separator style", () => {
    expect(
      isDirOnPath("C:\\Users\\tester\\.local\\bin", "win32", {
        PATH: "C:\\Windows;c:/users/tester/.local/bin",
      }),
    ).toBe(true);
  });
});
