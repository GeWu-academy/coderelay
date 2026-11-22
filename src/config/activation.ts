/**
 * Activation decisions: which CLIs the user has confirmed should run.
 *
 * `enabled` is the effective state; `activationDecided` records that the user
 * answered the question. The two differ because `enabled` defaults to `true`,
 * which on its own cannot tell "never asked" from "user opted in".
 */

import type { Config } from "./schema";
import { CLI_IDS, type CliId, type DetectedCli } from "../models/cli";

/** One CLI's activation state, as shown and toggled in the activation view. */
export interface ActivationOption {
  readonly cliId: CliId;
  /** Whether the binary was found on PATH; unavailable CLIs cannot be toggled. */
  readonly available: boolean;
  /** Effective state that will be written to `agents.<cli>.enabled`. */
  readonly enabled: boolean;
  /** Whether the user has already decided this CLI's activation state. */
  readonly decided: boolean;
}

function detectedFor(detected: readonly DetectedCli[], id: CliId): DetectedCli | undefined {
  return detected.find((item) => item.id === id);
}

/** Combine scan results with config into one row per CLI, in scan order. */
export function toActivationOptions(
  detected: readonly DetectedCli[],
  config: Config,
): ActivationOption[] {
  return CLI_IDS.map((cliId): ActivationOption => {
    const agentConfig = config.agents[cliId];
    const enabled = agentConfig?.enabled !== false;
    return {
      cliId,
      available: detectedFor(detected, cliId)?.available === true,
      enabled,
      // An explicit `enabled: false` is itself a decision, even without the flag.
      decided: agentConfig?.activationDecided === true || !enabled,
    };
  });
}

/** CLIs that are installed but have never been decided on — the first-run prompt. */
export function pendingActivation(
  options: readonly ActivationOption[],
): readonly ActivationOption[] {
  return options.filter((option) => option.available && !option.decided);
}

/**
 * Rows shown by the first-run activation page: only usable, undecided CLIs.
 * Uninstalled CLIs are reported by the scanner, not confirmed here.
 */
export function activationConfirmTargets(
  options: readonly ActivationOption[],
): readonly ActivationOption[] {
  return pendingActivation(options);
}

/** Rows shown by the `/activate` manager: every CLI, so any can be re-enabled. */
export function activationManageTargets(
  options: readonly ActivationOption[],
): readonly ActivationOption[] {
  return [...options];
}
