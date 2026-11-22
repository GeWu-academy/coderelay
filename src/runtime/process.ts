/**
 * Process runtime built on `Bun.spawn`.
 *
 * Every external agent (Codex CLI, Claude Code, ...) is launched through this
 * module so that streaming, capturing, timeouts and abort handling live in a
 * single place.
 */

export type OutputMode = "capture" | "stream";

export interface ProcessOptions {
  /** Full argv, first entry is the executable. */
  cmd: string[];
  /** Working directory for the child process. */
  cwd?: string;
  /** Extra environment variables merged over `process.env`. */
  env?: Record<string, string | undefined>;
  /** Data written to the child's stdin. */
  input?: string | Uint8Array;
  /**
   * `capture` (default) silently collects stdout/stderr.
   * `stream` mirrors both streams to the parent terminal while collecting them.
   */
  mode?: OutputMode;
  /** Abort the child when this signal fires. */
  signal?: AbortSignal;
  /** Kill the child after this many milliseconds. */
  timeoutMs?: number;
}

export interface ProcessResult {
  cmd: string[];
  /** Exit code, `-1` when the child was killed by a signal. */
  code: number;
  /** Signal that terminated the child, if any. */
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
  ok: boolean;
}

export class ProcessError extends Error {
  readonly result: ProcessResult;

  constructor(message: string, result: ProcessResult) {
    super(message);
    this.name = "ProcessError";
    this.result = result;
  }
}

async function readStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  mirror: boolean,
  sink: (chunk: string) => void,
): Promise<string> {
  if (!stream) {
    return "";
  }

  let output = "";
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    output += text;
    if (mirror) {
      sink(text);
    }
  }
  output += decoder.decode();
  return output;
}

/** Run a command to completion and capture its output. */
export async function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  const { cmd, cwd, env, input, mode = "capture", signal, timeoutMs } = options;

  if (cmd.length === 0) {
    throw new Error("runProcess requires a non-empty cmd array");
  }

  const startedAt = Date.now();
  const proc = Bun.spawn({
    cmd,
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, timeoutMs);
  }

  const onAbort = () => {
    proc.kill("SIGTERM");
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  if (input !== undefined && proc.stdin) {
    proc.stdin.write(input);
    proc.stdin.end();
  }

  const mirror = mode === "stream";
  const [stdout, stderr, code] = await Promise.all([
    readStream(proc.stdout as ReadableStream<Uint8Array> | undefined, mirror, (chunk) =>
      process.stdout.write(chunk),
    ),
    readStream(proc.stderr as ReadableStream<Uint8Array> | undefined, mirror, (chunk) =>
      process.stderr.write(chunk),
    ),
    proc.exited,
  ]);
  const signalCode = proc.signalCode;

  if (timer) {
    clearTimeout(timer);
  }
  signal?.removeEventListener("abort", onAbort);

  return {
    cmd,
    code: signalCode ? -1 : code,
    signal: signalCode,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    timedOut,
    aborted: signal?.aborted ?? false,
    ok: !signalCode && code === 0,
  };
}

/** Resolve an executable to an absolute path, or `null` when missing. */
export function resolveCommand(command: string): string | null {
  if (command.includes("/") || command.includes("\\")) {
    return Bun.which(command) ?? null;
  }
  return Bun.which(command);
}

/** Convenience wrapper: does this executable exist on PATH? */
export function commandExists(command: string): boolean {
  return resolveCommand(command) !== null;
}

/** Read the version reported by a command, for example `codex --version`. */
export async function commandVersion(
  command: string,
  args: string[] = ["--version"],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<string | null> {
  try {
    const result = await runProcess({
      cmd: [command, ...args],
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? 5_000,
    });
    if (!result.ok) {
      return null;
    }

    const line = `${result.stdout}\n${result.stderr}`.trim().split("\n")[0];
    return line?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Shell-quote an argv for display purposes (POSIX only). */
export function formatCommand(cmd: string[]): string {
  return cmd
    .map((part) =>
      /^[A-Za-z0-9_@%+=:,./-]+$/.test(part) ? part : `'${part.replaceAll("'", `'\\''`)}'`,
    )
    .join(" ");
}
