/**
 * Pure candidate-path construction: no I/O, so every platform's rules can be
 * tested from any host.
 *
 * A candidate is a *plausible* location for a CLI executable. Whether it
 * exists is decided later by the scanner's `access` check, and which one we
 * actually launch depends on real launchability — never on install source.
 */
import type { CliSource } from "../models/cli";

/** A directory that is known to hold executables from one install channel. */
export interface InstallDir {
  readonly dir: string;
  readonly source: CliSource;
}

/** PATHEXT used when the environment does not declare one. */
const DEFAULT_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];

function join(platform: NodeJS.Platform, ...parts: string[]): string {
  return platform === "win32" ? parts.join("\\") : parts.join("/");
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

/**
 * Executable file names for `bin` on `platform`, in preference order.
 * Windows shells resolve through PATHEXT; the bare name is kept last so an
 * extensionless shim still matches.
 */
export function executableNames(
  bin: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = {},
): readonly string[] {
  if (platform !== "win32") {
    return [bin];
  }

  const declared = env.PATHEXT?.trim();
  const extensions = (declared ? declared.split(";") : DEFAULT_PATHEXT)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const names: string[] = [];
  for (const extension of extensions) {
    const name = extension.startsWith(".") ? `${bin}${extension}` : `${bin}.${extension}`;
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  if (!names.includes(bin)) {
    names.push(bin);
  }
  return names;
}

/** All candidate paths for `bin` inside `dir`. */
export function candidatePathsInDir(
  dir: string,
  bin: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = {},
): readonly string[] {
  const separator = platform === "win32" ? "\\" : "/";
  const base = dir.endsWith("\\") || dir.endsWith("/") ? dir.slice(0, -1) : dir;
  return executableNames(bin, platform, env).map((name) => `${base}${separator}${name}`);
}

/**
 * Directories the per-user installers documented for Codex, Claude Code, Pi
 * and OMP write to, plus the per-user package-manager shim directories.
 */
export function userInstallDirs(
  platform: NodeJS.Platform,
  homeDir: string,
  env: NodeJS.ProcessEnv = {},
): readonly InstallDir[] {
  // Every documented `curl ... | sh` installer drops its binary into
  // ~/.local/bin; Bun's global bin sits next to it.
  const dirs: InstallDir[] = [
    { dir: join(platform, homeDir, ".local", "bin"), source: "installer" },
    { dir: join(platform, homeDir, ".bun", "bin"), source: "bun" },
  ];

  if (platform === "win32") {
    const appData = envValue(env, "APPDATA");
    if (appData) {
      dirs.push({ dir: join(platform, appData, "npm"), source: "npm" });
    }
    const localAppData = envValue(env, "LOCALAPPDATA");
    if (localAppData) {
      dirs.push({
        dir: join(platform, localAppData, "Microsoft", "WinGet", "Links"),
        source: "winget",
      });
    }
  }

  return dirs;
}

/** Well-known system-wide install directories for the current platform. */
export function standardInstallDirs(
  platform: NodeJS.Platform,
  homeDir: string,
): readonly InstallDir[] {
  const dirs: InstallDir[] = [];

  if (platform === "darwin") {
    // Both Homebrew prefixes: /opt/homebrew on Apple Silicon, /usr/local on
    // Intel. The architecture is never inferred from a file name.
    dirs.push({ dir: "/opt/homebrew/bin", source: "brew" });
    dirs.push({ dir: "/usr/local/bin", source: "brew" });
  }

  if (platform !== "win32") {
    dirs.push({
      dir: join(platform, homeDir, ".nix-profile", "bin"),
      source: "nix",
    });
    dirs.push({ dir: "/nix/var/nix/profiles/default/bin", source: "nix" });
    dirs.push({
      dir: join(platform, homeDir, ".local", "share", "mise", "shims"),
      source: "mise",
    });
  }

  return dirs;
}

function normalizeForCompare(value: string, platform: NodeJS.Platform): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Best-effort provenance for a path the shell resolved itself: if it sits in
 * a directory we recognise we can name the channel, otherwise it is a plain
 * PATH hit.
 */
export function classifySource(
  filePath: string,
  platform: NodeJS.Platform,
  homeDir: string,
  env: NodeJS.ProcessEnv = {},
): CliSource {
  return classifySourceIn(
    filePath,
    [...userInstallDirs(platform, homeDir, env), ...standardInstallDirs(platform, homeDir)],
    platform,
  );
}

/**
 * Provenance of `filePath` relative to the directories a scan actually
 * searched, so a package manager's own global bin is attributed to it.
 */
export function classifySourceIn(
  filePath: string,
  dirs: readonly InstallDir[],
  platform: NodeJS.Platform,
): CliSource {
  const target = normalizeForCompare(filePath, platform);

  for (const entry of dirs) {
    const dir = normalizeForCompare(entry.dir, platform);
    if (dir && target.startsWith(`${dir}/`)) {
      return entry.source;
    }
  }

  return "path";
}

/** Drop duplicate paths, keeping the first (highest-priority) occurrence. */
export function dedupePaths(
  paths: readonly string[],
  platform: NodeJS.Platform,
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of paths) {
    const key = normalizeForCompare(candidate, platform);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

/** PATH entries for `platform` (`;` on Windows, `:` everywhere else). */
export function pathEntries(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = {},
): readonly string[] {
  return (env.PATH ?? "")
    .split(platform === "win32" ? ";" : ":")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Would the current shell find an executable placed in `dir`? */
export function isDirOnPath(
  dir: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = {},
): boolean {
  const target = normalizeForCompare(dir, platform);
  return pathEntries(platform, env).some(
    (entry) => normalizeForCompare(entry, platform) === target,
  );
}
