import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  CLI_DEFINITIONS,
  DEFAULT_VERSION_ARGS,
  type CliCandidate,
  type CliDefinition,
  type CliDiagnostic,
  type CliSource,
  type DetectedCli,
  type ExecFileRequestOptions,
  type ExecFileRunner,
  type HostAgent,
} from "../models/cli";
import {
  candidatePathsInDir,
  classifySourceIn,
  dedupePaths,
  type InstallDir,
  isDirOnPath,
  standardInstallDirs,
  userInstallDirs,
} from "./candidate-paths";
import { probeVersion } from "./version-probe";

export type FileAccess = (path: string, mode?: number) => Promise<void>;
export type FileRead = (
  path: string,
  encoding: BufferEncoding,
) => Promise<string>;
export type DirRead = (path: string) => Promise<string[]>;

export interface ScannerOptions {
  readonly execFile?: ExecFileRunner;
  readonly access?: FileAccess;
  readonly readFile?: FileRead;
  readonly readdir?: DirRead;
  readonly platform?: NodeJS.Platform;
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly resolveTimeoutMs?: number;
  readonly versionTimeoutMs?: number;
  readonly versionArgs?: readonly (readonly string[])[];
}

interface ResolvedScannerOptions {
  readonly execFile: ExecFileRunner;
  readonly access: FileAccess;
  readonly readFile: FileRead;
  readonly readdir: DirRead;
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly resolveTimeoutMs: number;
  readonly versionTimeoutMs: number;
  readonly versionArgs: readonly (readonly string[])[];
}

const execFileAsync = promisify(execFile);

const defaultExecFile: ExecFileRunner = async (file, args, options = {}) => {
  const result = await execFileAsync(file, [...args], {
    ...options,
    encoding: "utf8",
  });

  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
};

function resolveScannerOptions(
  options: ScannerOptions = {},
): ResolvedScannerOptions {
  const platform = options.platform ?? process.platform;
  return {
    execFile: options.execFile ?? defaultExecFile,
    access: options.access ?? access,
    readFile: options.readFile ?? ((p, enc) => readFile(p, enc)),
    readdir: options.readdir ?? ((p) => readdir(p)),
    platform,
    homeDir: options.homeDir ?? homedir(),
    env: options.env ?? process.env,
    resolveTimeoutMs: options.resolveTimeoutMs ?? 3_000,
    versionTimeoutMs: options.versionTimeoutMs ?? 5_000,
    versionArgs: options.versionArgs ?? DEFAULT_VERSION_ARGS,
  };
}

function lines(stdout: string): readonly string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function dirNameOf(filePath: string, platform: NodeJS.Platform): string {
  const split = platform === "win32" ? path.win32 : path.posix;
  return split.dirname(filePath);
}

/** Is the directory holding `filePath` reachable from the current shell? */
function isFileReachableFromShell(
  filePath: string,
  resolved: ResolvedScannerOptions,
): boolean {
  return isDirOnPath(
    dirNameOf(filePath, resolved.platform),
    resolved.platform,
    resolved.env,
  );
}

/**
 * Every path the current shell resolves for `bin`, in PATH order. On Windows
 * `where` reports each matching extension; on Unix `which` reports every match
 * across PATH entries. `command -v` is the fallback when `which` is missing
 * (it is a shell builtin, `which` is not always installed).
 */
async function resolveAllOnPath(
  bin: string,
  resolved: ResolvedScannerOptions,
): Promise<readonly string[]> {
  const lookupCommand = resolved.platform === "win32" ? "where" : "which";
  const requestOptions: ExecFileRequestOptions = {
    timeout: resolved.resolveTimeoutMs,
    windowsHide: true,
  };

  try {
    const { stdout } = await resolved.execFile(
      lookupCommand,
      [bin],
      requestOptions,
    );
    const found = lines(stdout);
    if (found.length > 0) {
      return found;
    }
  } catch {
    // Fall through to the shell builtin below.
  }

  if (resolved.platform === "win32") {
    return [];
  }

  try {
    const { stdout } = await resolved.execFile(
      "sh",
      ["-lc", `command -v ${bin}`],
      requestOptions,
    );
    return lines(stdout);
  } catch {
    return [];
  }
}

export async function resolveOnPath(
  bin: string,
  options: ScannerOptions = {},
): Promise<string | null> {
  const resolved = resolveScannerOptions(options);
  const found = await resolveAllOnPath(bin, resolved);
  return found[0] ?? null;
}

export async function getCliVersion(
  binPath: string,
  options: ScannerOptions = {},
): Promise<string | null> {
  const resolved = resolveScannerOptions(options);

  return probeVersion([binPath], {
    execFile: resolved.execFile,
    timeoutMs: resolved.versionTimeoutMs,
    versionArgs: resolved.versionArgs,
  });
}

/**
 * The documented Windows fallback order for Claude Code: the native installer
 * location first, then the npm shim, then Bun's global bin.
 */
export async function getWindowsClaudeFallback(
  options: ScannerOptions = {},
): Promise<string | null> {
  const resolved = resolveScannerOptions(options);
  if (resolved.platform !== "win32") {
    return null;
  }

  const windowsPath = path.win32;
  const appData = resolved.env.APPDATA?.trim();
  const candidates = [
    windowsPath.join(resolved.homeDir, ".local", "bin", "claude.exe"),
    appData ? windowsPath.join(appData, "npm", "claude.cmd") : null,
    windowsPath.join(resolved.homeDir, ".bun", "bin", "claude.exe"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await resolved.access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the documented fallback list.
    }
  }

  return null;
}

/**
 * Read the CLI executable path from CODEX_CLI_PATH environment variable,
 * or standard app bundles on macOS.
 */
export async function getCodexConfigFallback(
  options: ScannerOptions = {},
): Promise<string | null> {
  const resolved = resolveScannerOptions(options);

  const envCliPath = resolved.env.CODEX_CLI_PATH?.trim();
  if (envCliPath) {
    try {
      await resolved.access(envCliPath, constants.X_OK);
      return envCliPath;
    } catch (error) {
      throw new Error(
        `invalid CODEX_CLI_PATH: "${envCliPath}" does not exist or is not executable`,
        { cause: error },
      );
    }
  }

  if (resolved.platform === "darwin") {
    const appCandidates = [
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      path.posix.join(
        resolved.homeDir,
        "Applications",
        "ChatGPT.app",
        "Contents",
        "Resources",
        "codex",
      ),
    ];
    for (const candidate of appCandidates) {
      try {
        await resolved.access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Continue through candidates
      }
    }
  }

  return null;
}

/**
 * Detect native Claude Code versions in ~/.local/share/claude/versions.
 */
export async function getUnixClaudeVersionFallback(
  options: ScannerOptions = {},
): Promise<string | null> {
  const resolved = resolveScannerOptions(options);
  if (resolved.platform === "win32") {
    return null;
  }

  const versionsDir = path.posix.join(
    resolved.homeDir,
    ".local",
    "share",
    "claude",
    "versions",
  );

  try {
    const entries = await resolved.readdir(versionsDir);
    const sorted = [...entries].sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    );
    for (const entry of sorted) {
      const candidate = path.posix.join(versionsDir, entry);
      try {
        await resolved.access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Continue through candidates
      }
    }
  } catch {
    // Directory unreadable or missing
  }

  return null;
}

/** Global bin directories published by package managers, probed once per scan. */
async function probePackageBinDirs(
  resolved: ResolvedScannerOptions,
): Promise<readonly InstallDir[]> {
  interface PackageProbe {
    readonly command: string;
    readonly args: readonly string[];
    readonly source: CliSource;
    readonly toDir: (stdout: string) => string;
  }

  const probes: PackageProbe[] = [
    {
      command: "npm",
      args: ["prefix", "-g"],
      source: "npm",
      // npm keeps executables in <prefix>/bin on Unix, directly in <prefix>
      // on Windows (the .cmd shims live there too).
      toDir: (stdout) =>
        resolved.platform === "win32" ? stdout : `${stdout}/bin`,
    },
    {
      command: "bun",
      args: ["pm", "bin", "-g"],
      source: "bun",
      toDir: (stdout) => stdout,
    },
    {
      command: "pnpm",
      args: ["bin", "-g"],
      source: "pnpm",
      toDir: (stdout) => stdout,
    },
    {
      command: "yarn",
      args: ["global", "bin"],
      source: "yarn",
      toDir: (stdout) => stdout,
    },
  ];

  if (resolved.platform === "darwin") {
    probes.push({
      command: "brew",
      args: ["--prefix"],
      source: "brew",
      toDir: (stdout) => `${stdout}/bin`,
    });
  }

  const results = await Promise.all(
    probes.map(async (probe) => {
      try {
        const { stdout } = await resolved.execFile(probe.command, probe.args, {
          timeout: resolved.resolveTimeoutMs,
          windowsHide: true,
        });
        const first = lines(stdout)[0];
        return first ? { dir: probe.toDir(first), source: probe.source } : null;
      } catch {
        // A missing or failing package manager simply contributes no directory.
        return null;
      }
    }),
  );

  return results.filter((entry): entry is InstallDir => entry !== null);
}

interface LocalCandidate {
  readonly path: string;
  readonly source: CliSource;
}

async function accessible(
  candidate: string,
  resolved: ResolvedScannerOptions,
): Promise<boolean> {
  try {
    await resolved.access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every launchable executable for one CLI, in preference order: what the
 * current shell resolves first, then the documented Claude Windows fallback,
 * then package-manager and installer directories. Install source never
 * outranks real launchability — the order here is the order we try.
 */
async function collectLocalCandidates(
  definition: CliDefinition,
  resolved: ResolvedScannerOptions,
  packageDirs: readonly InstallDir[],
  searchedDirs: string[],
): Promise<readonly LocalCandidate[]> {
  const directories: readonly InstallDir[] = [
    ...packageDirs,
    ...userInstallDirs(resolved.platform, resolved.homeDir, resolved.env),
    ...standardInstallDirs(resolved.platform, resolved.homeDir),
  ];
  for (const entry of directories) {
    searchedDirs.push(entry.dir);
  }

  // Attribution uses the directories this scan actually looked in, so a path
  // under a package manager's global bin is credited to that package manager.
  const sourceOf = (filePath: string): CliSource =>
    classifySourceIn(filePath, directories, resolved.platform);

  const ordered: LocalCandidate[] = [];

  for (const found of await resolveAllOnPath(definition.bin, resolved)) {
    ordered.push({ path: found, source: sourceOf(found) });
  }

  if (definition.id === "codex") {
    const fallback = await getCodexConfigFallback({
      platform: resolved.platform,
      homeDir: resolved.homeDir,
      env: resolved.env,
      access: resolved.access,
    });
    if (fallback) {
      ordered.push({ path: fallback, source: "installer" });
    }
  }

  if (definition.id === "claude") {
    if (resolved.platform === "win32") {
      const fallback = await getWindowsClaudeFallback({
        platform: resolved.platform,
        homeDir: resolved.homeDir,
        env: resolved.env,
        access: resolved.access,
      });
      if (fallback) {
        ordered.push({ path: fallback, source: "fallback" });
      }
    } else {
      const versionsDir = path.posix.join(
        resolved.homeDir,
        ".local",
        "share",
        "claude",
        "versions",
      );
      searchedDirs.push(versionsDir);
      const fallback = await getUnixClaudeVersionFallback({
        platform: resolved.platform,
        homeDir: resolved.homeDir,
        env: resolved.env,
        access: resolved.access,
        readdir: resolved.readdir,
      });
      if (fallback) {
        ordered.push({ path: fallback, source: "installer" });
      }
    }
  }

  const inDirs = dedupePaths(
    directories.flatMap((entry) =>
      candidatePathsInDir(
        entry.dir,
        definition.bin,
        resolved.platform,
        resolved.env,
      ),
    ),
    resolved.platform,
  );

  for (const candidate of inDirs) {
    ordered.push({ path: candidate, source: sourceOf(candidate) });
  }

  const deduped = dedupePaths(
    ordered.map((entry) => entry.path),
    resolved.platform,
  );
  const byPath = new Map(ordered.map((entry) => [entry.path, entry.source]));
  const launchable: LocalCandidate[] = [];
  for (const candidate of deduped) {
    if (await accessible(candidate, resolved)) {
      launchable.push({
        path: candidate,
        source: byPath.get(candidate) ?? "path",
      });
    }
  }

  return launchable;
}

async function toLocalCandidates(
  local: readonly LocalCandidate[],
  resolved: ResolvedScannerOptions,
): Promise<readonly CliCandidate[]> {
  return Promise.all(
    local.map(async (entry) => ({
      path: entry.path,
      runtime: "local" as const,
      source: entry.source,
      version: await probeVersion([entry.path], {
        execFile: resolved.execFile,
        timeoutMs: resolved.versionTimeoutMs,
        versionArgs: resolved.versionArgs,
      }),
    })),
  );
}

function selectedFrom(
  candidates: readonly CliCandidate[],
): CliCandidate | null {
  return candidates[0] ?? null;
}

function buildDiagnostics(
  definition: CliDefinition,
  resolved: ResolvedScannerOptions,
  selected: CliCandidate | null,
  searchedDirs: readonly string[],
): readonly CliDiagnostic[] {
  const diagnostics: CliDiagnostic[] = [];

  if (!selected) {
    diagnostics.push({
      level: "info",
      message: `未发现 ${definition.bin}。已检查 PATH 与常见安装目录：${[
        ...new Set(searchedDirs),
      ].join(", ")}`,
    });
    return diagnostics;
  }

  if (selected.version === null) {
    diagnostics.push({
      level: "warn",
      message: `已找到 ${selected.path}，但版本探测失败；该 CLI 可能未完整安装。`,
    });
  }

  if (!isFileReachableFromShell(selected.path, resolved)) {
    diagnostics.push({
      level: "warn",
      message: `已安装但不在当前 PATH：${dirNameOf(
        selected.path,
        resolved.platform,
      )}。若要在终端直接调用 ${definition.bin}，请把该目录加入 PATH 并重新打开终端。`,
    });
  }

  return diagnostics;
}

async function scanCli(
  definition: CliDefinition,
  resolved: ResolvedScannerOptions,
  packageDirs: readonly InstallDir[],
): Promise<DetectedCli> {
  const searchedDirs: string[] = [];
  const local = await collectLocalCandidates(
    definition,
    resolved,
    packageDirs,
    searchedDirs,
  );
  const candidates = await toLocalCandidates(local, resolved);
  const selected = selectedFrom(candidates);
  const diagnostics = buildDiagnostics(
    definition,
    resolved,
    selected,
    searchedDirs,
  );

  if (!selected) {
    return {
      id: definition.id,
      bin: definition.bin,
      path: "",
      version: null,
      available: false,
      runtime: "local",
      source: "path",
      candidates,
      diagnostics,
    };
  }

  return {
    id: definition.id,
    bin: definition.bin,
    path: selected.path,
    version: selected.version,
    available: true,
    runtime: selected.runtime,
    source: selected.source,
    candidates,
    diagnostics,
  };
}

/** Scan supported CLIs concurrently while preserving canonical result order. */
export async function scanCodingClis(
  options: ScannerOptions = {},
): Promise<DetectedCli[]> {
  const resolved = resolveScannerOptions(options);

  // Resolved once per scan and shared by every CLI: package manager lookups
  // are slower than the per-CLI checks.
  const packageDirs = await probePackageBinDirs(resolved);

  return Promise.all(
    CLI_DEFINITIONS.map((definition) =>
      scanCli(definition, resolved, packageDirs),
    ),
  );
}

/** Detect one of the runtime host markers documented for Claude Code and Pi. */
export function detectHostAgent(
  env: NodeJS.ProcessEnv = process.env,
): HostAgent | null {
  if (env.CLAUDECODE === "1" || env.CLAUDE_CODE_CHILD_SESSION === "1") {
    return "claude";
  }

  if (env.PI_CODING_AGENT === "true" || env.PI_CODING_AGENT === "1") {
    return "pi";
  }

  return null;
}
