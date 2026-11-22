import { loadConfig } from "../config/loader";
import type { Config } from "../config/schema";
import { CLI_IDS, type CliId } from "../models/cli";
import type { ModelStrength } from "../models/types";
import { buildRouteCandidates } from "../router/router";

const AGENT_LABELS: Readonly<Record<CliId, string>> = {
  codex: "Codex",
  claude: "Claude Code",
  pi: "Pi",
  omp: "OMP",
};

export interface ModelListEntry {
  readonly model?: string;
  readonly label?: string;
  readonly strengths: readonly ModelStrength[];
  readonly isDefault: boolean;
}

export interface ModelListGroup {
  readonly id: CliId;
  readonly label: string;
  readonly models: readonly ModelListEntry[];
}

export interface ModelCommandOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly config?: Config;
}

export interface ModelCommandDependencies {
  readonly write?: (text: string) => void;
}

/**
 * Build the model listing from configured candidates.
 *
 * An agent without configured models is represented by one entry without a
 * model id, which means the adapter's own default is used.
 */
export function buildModelList(config: Config): ModelListGroup[] {
  const candidates = buildRouteCandidates(config, {
    availableAgents: CLI_IDS,
  });
  const groups: ModelListGroup[] = [];

  for (const id of CLI_IDS) {
    if (config.agents[id]?.enabled === false) {
      continue;
    }

    const configured = candidates
      .filter((candidate) => candidate.agent === id)
      .map((candidate) => ({
        model: candidate.model,
        label: candidate.label,
        strengths: candidate.strengths,
        isDefault: candidate.isDefault,
      }));

    groups.push({
      id,
      label: AGENT_LABELS[id],
      models:
        configured.length > 0
          ? configured
          : [{ strengths: [], isDefault: config.defaultAgent === id }],
    });
  }

  return groups;
}

export function formatModelList(groups: readonly ModelListGroup[]): string {
  return groups
    .map((group) => {
      const models = group.models
        .map((entry) => {
          const model = entry.model ?? "(adapter default)";
          const label = entry.label && entry.label !== entry.model ? ` (${entry.label})` : "";
          const defaultMarker = entry.isDefault ? " [default]" : "";
          const strengths = entry.strengths.length > 0 ? ` [${entry.strengths.join(", ")}]` : "";
          return `  - ${model}${label}${defaultMarker}${strengths}`;
        })
        .join("\n");

      return `${group.label} (${group.id})\n${models}`;
    })
    .join("\n\n");
}

export async function runModelsCommand(
  options: ModelCommandOptions = {},
  dependencies: ModelCommandDependencies = {},
): Promise<number> {
  const write = dependencies.write ?? ((text: string) => process.stdout.write(text));

  try {
    const loaded =
      options.config === undefined
        ? await loadConfig({ cwd: options.cwd, path: options.configPath })
        : { config: options.config };
    write(`${formatModelList(buildModelList(loaded.config))}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(`coderelay models: ${message}\n`);
    return 1;
  }
}
