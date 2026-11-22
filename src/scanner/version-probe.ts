/**
 * Version probing for discovered CLI candidates.
 *
 * Every probe is isolated: a CLI that ignores or rejects a version flag, times
 * out, or exits non-zero simply yields `null` and never fails the scan.
 */
import type { ExecFileRequestOptions, ExecFileRunner } from "../models/cli";

export interface VersionProbeOptions {
  readonly execFile: ExecFileRunner;
  readonly timeoutMs: number;
  readonly versionArgs: readonly (readonly string[])[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export function firstNonEmptyLine(value: string): string | null {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

/**
 * Run `<prefix> <versionFlag>` for each documented flag and return the first
 * non-empty output line. Some CLIs print their version on stderr, so both
 * streams are considered.
 */
export async function probeVersion(
  prefix: readonly string[],
  options: VersionProbeOptions,
): Promise<string | null> {
  const [file, ...baseArgs] = prefix;
  if (!file) {
    return null;
  }

  for (const args of options.versionArgs) {
    try {
      const { stdout, stderr } = await options.execFile(file, [...baseArgs, ...args], {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        windowsHide: true,
      } satisfies ExecFileRequestOptions);
      const version = firstNonEmptyLine(stdout.trim() ? stdout : stderr);
      if (version) {
        return version;
      }
    } catch {
      // Try the next documented flag; one failed probe never fails the scan.
    }
  }

  return null;
}
