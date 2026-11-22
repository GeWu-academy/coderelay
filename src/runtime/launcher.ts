import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import type {
  CliAdapter,
  ExecFileRequestOptions,
  ExecFileResult,
  ExecFileRunner,
  LaunchTarget,
  SpawnRequestOptions,
  SpawnRunner,
} from "../models/cli";

export interface LaunchProcessOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Runtime context from the scan. Omitting it means "a plain local
   * executable", which keeps hand-built callers working.
   */
  readonly target?: LaunchTarget;
}

export interface LaunchInteractiveOptions extends LaunchProcessOptions {
  readonly binPath?: string;
  readonly extraArgs?: readonly string[];
  readonly dependencies?: Partial<LauncherDependencies>;
}

export interface LaunchPromptOptions extends LaunchProcessOptions {
  readonly binPath?: string;
  readonly extraArgs?: readonly string[];
  readonly dependencies?: Partial<LauncherDependencies>;
}

export interface RunOnceOptions extends LaunchProcessOptions {
  readonly timeoutMs?: number;
  readonly maxBuffer?: number;
  readonly dependencies?: Partial<LauncherDependencies>;
}

export interface RunOnceResult {
  readonly ok: true;
  readonly stdout: string;
  readonly stderr: string;
  readonly code: 0;
  readonly signal: null;
}

export interface LauncherDependencies {
  readonly spawn: SpawnRunner;
  readonly execFile: ExecFileRunner;
  readonly platform: NodeJS.Platform;
}

const execFileAsync: ExecFileRunner = (file, args, options = {}) =>
  new Promise<ExecFileResult>((resolve, reject) => {
    execFile(
      file,
      [...args],
      { ...options, encoding: "utf8" },
      (error, stdout, stderr) => {
        const stdoutText = valueAsString(stdout);
        const stderrText = valueAsString(stderr);

        if (error) {
          reject(
            Object.assign(error, {
              stdout: stdoutText,
              stderr: stderrText,
            }),
          );
          return;
        }

        resolve({ stdout: stdoutText, stderr: stderrText });
      },
    );
  });

const defaultSpawn: SpawnRunner = (file, args, options = {}) =>
  spawn(file, [...args], options);

const DEFAULT_DEPENDENCIES: LauncherDependencies = {
  spawn: defaultSpawn,
  execFile: execFileAsync,
  platform: process.platform,
};

function resolveDependencies(
  overrides?: Partial<LauncherDependencies>,
): LauncherDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

/**
 * Turn a scanned runtime context plus CLI arguments into the argv the host
 * must actually spawn.
 */
export function buildLaunchArgv(
  target: LaunchTarget,
  args: readonly string[] = [],
): { readonly file: string; readonly args: readonly string[] } {
  return { file: target.path, args: [...args] };
}

/** Full argv with the executable first, for `cmd[]`-style runtimes. */
export function buildLaunchCmd(
  target: LaunchTarget,
  args: readonly string[] = [],
): string[] {
  const argv = buildLaunchArgv(target, args);
  return [argv.file, ...argv.args];
}

/** The working directory for the child process. */
export function resolveLaunchCwd(
  cwd: string | undefined,
  _target?: LaunchTarget | { readonly runtime?: string },
): string | undefined {
  return cwd;
}

export function createSpawnOptions(
  options: LaunchProcessOptions,
  platform: NodeJS.Platform,
): SpawnRequestOptions {
  return {
    cwd: resolveLaunchCwd(options.cwd, options.target),
    env: options.env ?? process.env,
    stdio: "inherit",
    shell: platform === "win32",
    windowsHide: platform === "win32",
  };
}

/** Runtime context for a launcher call, defaulting to a local executable. */
function launchTargetFor(
  fallbackPath: string,
  options: LaunchProcessOptions,
): LaunchTarget {
  return options.target ?? { path: fallbackPath, runtime: "local" };
}

export function buildPromptArgs(
  adapter: CliAdapter,
  prompt: string,
  extraArgs: readonly string[] = [],
): string[] {
  return [...adapter.promptArgs(prompt), ...extraArgs];
}

export function launchInteractive(
  adapterOrPath: CliAdapter | string,
  options: LaunchInteractiveOptions = {},
): ReturnType<SpawnRunner> {
  const dependencies = resolveDependencies(options.dependencies);
  const declaredPath = typeof adapterOrPath === "string"
    ? adapterOrPath
    : options.binPath ?? adapterOrPath.bin;
  const baseArgs = typeof adapterOrPath === "string"
    ? []
    : adapterOrPath.interactiveArgs;
  const argv = buildLaunchArgv(
    launchTargetFor(declaredPath, options),
    [...baseArgs, ...(options.extraArgs ?? [])],
  );

  return dependencies.spawn(
    argv.file,
    argv.args,
    createSpawnOptions(options, dependencies.platform),
  );
}

export function launchWithPrompt(
  adapter: CliAdapter,
  prompt: string,
  options: LaunchPromptOptions = {},
): ReturnType<SpawnRunner> {
  const dependencies = resolveDependencies(options.dependencies);
  const argv = buildLaunchArgv(
    launchTargetFor(options.binPath ?? adapter.bin, options),
    buildPromptArgs(adapter, prompt, options.extraArgs),
  );

  return dependencies.spawn(
    argv.file,
    argv.args,
    createSpawnOptions(options, dependencies.platform),
  );
}

export interface LaunchCapturedOptions extends LaunchProcessOptions {
  readonly binPath?: string;
  readonly extraArgs?: readonly string[];
  readonly dependencies?: Partial<LauncherDependencies>;
  /** 每路输出保留的尾部字符数，防止长任务把内存吃满。 */
  readonly maxOutputChars?: number;
}

export interface CapturedLaunchResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CapturedLaunchHandle {
  readonly child: ChildProcess;
  readonly done: Promise<CapturedLaunchResult>;
}

const DEFAULT_MAX_OUTPUT_CHARS = 20_000;

function createCaptureOptions(
  options: LaunchProcessOptions,
  platform: NodeJS.Platform,
): SpawnRequestOptions {
  return {
    cwd: resolveLaunchCwd(options.cwd, options.target),
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: platform === "win32",
    windowsHide: platform === "win32",
  };
}

function appendTail(buffer: string, chunk: string, maxChars: number): string {
  const merged = buffer + chunk;
  return merged.length > maxChars * 2 ? merged.slice(-maxChars) : merged;
}

/**
 * Launch a prompt-mode CLI with piped output so the UI can render the result
 * itself. Resolves on `close` — after all stdio data has drained — with the
 * tail of both streams; spawn failures resolve with a null code.
 */
export function launchWithPromptCaptured(
  adapter: CliAdapter,
  prompt: string,
  options: LaunchCapturedOptions = {},
): CapturedLaunchHandle {
  const dependencies = resolveDependencies(options.dependencies);
  const maxChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const argv = buildLaunchArgv(
    launchTargetFor(options.binPath ?? adapter.bin, options),
    buildPromptArgs(adapter, prompt, options.extraArgs),
  );

  const child = dependencies.spawn(
    argv.file,
    argv.args,
    createCaptureOptions(options, dependencies.platform),
  );

  const done = new Promise<CapturedLaunchResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        code,
        signal,
        stdout: stdout.slice(-maxChars),
        stderr: stderr.slice(-maxChars),
      });
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = appendTail(stdout, chunk.toString(), maxChars);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = appendTail(stderr, chunk.toString(), maxChars);
    });
    child.once("close", (code, signal) => {
      finish(code, signal);
    });
    child.once("error", () => {
      finish(null, null);
    });
  });

  return { child, done };
}

function valueAsString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return String(value);
}

export interface CliProcessErrorDetails {
  readonly binPath: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export class CliProcessError extends Error {
  readonly binPath: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;

  constructor(
    message: string,
    details: CliProcessErrorDetails,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = "CliProcessError";
    this.binPath = details.binPath;
    this.code = details.code;
    this.signal = details.signal;
    this.stdout = details.stdout;
    this.stderr = details.stderr;
    this.timedOut = details.timedOut;
  }
}

function processError(
  binPath: string,
  error: unknown,
  timeoutMs: number,
): CliProcessError {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const rawCode = record.code;
  const code = typeof rawCode === "number" ? rawCode : null;
  const signal =
    typeof record.signal === "string"
      ? (record.signal as NodeJS.Signals)
      : null;
  const timedOut = rawCode === "ETIMEDOUT";
  const stdout = valueAsString(record.stdout);
  const stderr = valueAsString(record.stderr);
  const causeMessage = error instanceof Error ? error.message : String(error);
  const message = timedOut
    ? `CLI command timed out after ${timeoutMs}ms: ${binPath}`
    : `CLI command failed${code === null ? "" : ` with exit code ${code}`}: ${causeMessage}`;

  return new CliProcessError(
    message,
    {
      binPath,
      code,
      signal,
      stdout,
      stderr,
      timedOut,
    },
    error,
  );
}

/** Execute a CLI once, returning output only for a successful zero exit. */
export async function runOnce(
  binPath: string,
  args: readonly string[],
  options: RunOnceOptions = {},
): Promise<RunOnceResult> {
  const dependencies = resolveDependencies(options.dependencies);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024;
  const target = options.target ?? { path: binPath, runtime: "local" as const };
  const argv = buildLaunchArgv(target, args);
  const execOptions: ExecFileRequestOptions = {
    cwd: resolveLaunchCwd(options.cwd, options.target),
    env: options.env ?? process.env,
    timeout: timeoutMs,
    maxBuffer,
    windowsHide: true,
    shell: dependencies.platform === "win32",
  };

  try {
    const { stdout, stderr } = await dependencies.execFile(
      argv.file,
      argv.args,
      execOptions,
    );
    return { ok: true, stdout, stderr, code: 0, signal: null };
  } catch (error) {
    throw processError(binPath, error, timeoutMs);
  }
}
