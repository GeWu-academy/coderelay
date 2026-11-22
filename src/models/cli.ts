import type { ChildProcess } from "node:child_process";

import type { AgentEvent } from "./agent-events";
import type { CliCapabilities, ProbeResult } from "../agents/capabilities";

/** Supported coding-agent CLI identifiers, in canonical scan order. */
export const CLI_IDS = ["codex", "claude", "pi", "omp"] as const;

export type CliId = (typeof CLI_IDS)[number];

/** Agents that expose a documented host-environment marker. */
export type HostAgent = Extract<CliId, "claude" | "pi">;

/** Version flags are attempted in this order for every CLI. */
export const DEFAULT_VERSION_ARGS: readonly (readonly string[])[] = [
  ["--version"],
  ["-v"],
  ["-V"],
];

/** Static metadata shared by scanners and adapters. */
export interface CliDefinition {
  readonly id: CliId;
  readonly bin: string;
  readonly versionArgs: readonly (readonly string[])[];
}

export const CLI_DEFINITIONS: readonly CliDefinition[] = [
  { id: "codex", bin: "codex", versionArgs: DEFAULT_VERSION_ARGS },
  { id: "claude", bin: "claude", versionArgs: DEFAULT_VERSION_ARGS },
  { id: "pi", bin: "pi", versionArgs: DEFAULT_VERSION_ARGS },
  { id: "omp", bin: "omp", versionArgs: DEFAULT_VERSION_ARGS },
];

/**
 * Where a discovered executable actually runs. `local` means the current
 * process can spawn it directly.
 */
export type CliRuntime = "local";

/** Installation channel behind a discovered executable. */
export type CliSource =
  | "path"
  | "npm"
  | "bun"
  | "pnpm"
  | "yarn"
  | "brew"
  | "winget"
  | "installer"
  | "nix"
  | "mise"
  | "fallback";

/** One concrete executable found for a CLI, with its provenance. */
export interface CliCandidate {
  readonly path: string;
  readonly runtime: CliRuntime;
  readonly source: CliSource;
  readonly version: string | null;
}

/** Non-fatal observation recorded while scanning, surfaced by `doctor`. */
export interface CliDiagnostic {
  readonly level: "info" | "warn";
  readonly message: string;
}

/**
 * Result of scanning the host for one supported CLI.
 *
 * `path`/`version`/`available` always describe the single selected candidate.
 * The scan metadata below is optional only so hand-built fixtures stay valid;
 * `scanCodingClis` always populates it — read it through the `cli*` helpers.
 */
export interface DetectedCli {
  readonly id: CliId;
  readonly bin: string;
  readonly path: string;
  readonly version: string | null;
  readonly available: boolean;
  readonly runtime?: CliRuntime;
  readonly source?: CliSource;
  /** Every candidate found, selected one first, in resolution order. */
  readonly candidates?: readonly CliCandidate[];
  readonly diagnostics?: readonly CliDiagnostic[];
}

/** How to start a CLI: the executable plus the runtime it belongs to. */
export interface LaunchTarget {
  readonly path: string;
  readonly runtime: CliRuntime;
}

export function cliRuntime(cli: DetectedCli): CliRuntime {
  return cli.runtime ?? "local";
}

export function cliSource(cli: DetectedCli): CliSource {
  return cli.source ?? "path";
}

export function cliCandidates(cli: DetectedCli): readonly CliCandidate[] {
  return cli.candidates ?? [];
}

export function cliDiagnostics(cli: DetectedCli): readonly CliDiagnostic[] {
  return cli.diagnostics ?? [];
}

/** Launch target for a scan result, or `null` when nothing was found. */
export function cliLaunchTarget(cli: DetectedCli): LaunchTarget | null {
  if (!cli.available || !cli.path) {
    return null;
  }

  return {
    path: cli.path,
    runtime: cliRuntime(cli),
  };
}

export interface PromptBuildOptions {
  readonly prompt: string;
  readonly model?: string;
  readonly extraArgs?: readonly string[];
  /** 原生会话 id（CLI 支持 resume 时使用）。 */
  readonly nativeSessionId?: string;
}

/** Uniform metadata and argument construction for one CLI. */
export interface CliAdapter {
  readonly id: CliId;
  readonly bin: string;
  readonly configDir: string;
  readonly versionArgs: readonly (readonly string[])[];
  readonly interactiveArgs: readonly string[];
  readonly promptArgs: (prompt: string) => readonly string[];
  /** 探测本机已配置模型；失败时带 reason，禁止静默转默认。 */
  readonly probeModels?: () => Promise<ProbeResult>;
  readonly probeCapabilities?: () => CliCapabilities;
  /** 非交互任务参数（含模型选择与原生恢复）。 */
  readonly buildPromptArgs?: (options: PromptBuildOptions) => readonly string[];
  /** 将原始 stdout/stderr 片段解析为统一事件。 */
  readonly parseOutputChunk?: (
    chunk: string,
    source: "stdout" | "stderr",
  ) => readonly AgentEvent[];
  readonly defaultModel?: () => string | undefined;
}

/** Options accepted by the Node `execFile` runner used by the scanner. */
export interface ExecFileRequestOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeout?: number;
  readonly maxBuffer?: number;
  readonly windowsHide?: boolean;
  readonly shell?: boolean;
}

export interface ExecFileResult {
  readonly stdout: string;
  readonly stderr: string;
}

export type ExecFileRunner = (
  file: string,
  args: readonly string[],
  options?: ExecFileRequestOptions,
) => Promise<ExecFileResult>;

/** Per-fd stdio setting accepted by the Node `spawn` runner. */
export type SpawnStdio = "inherit" | "pipe" | "ignore";

/** Options accepted by the Node `spawn` runner used by the launcher. */
export interface SpawnRequestOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdio?: SpawnStdio | [SpawnStdio, SpawnStdio, SpawnStdio];
  readonly shell?: boolean;
  readonly windowsHide?: boolean;
}

export type SpawnRunner = (
  file: string,
  args: readonly string[],
  options?: SpawnRequestOptions,
) => ChildProcess;
