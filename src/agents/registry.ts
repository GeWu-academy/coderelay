import { createCliAdapters, type CliAdapterOptions } from "./cli-adapters";
import { createClaudeAdapter } from "./claude";
import { createCodexAdapter } from "./codex";
import { createAgentAdapter, type AgentAdapter } from "./adapter";
import { CLI_IDS, type CliId } from "../models/cli";

export type AgentRegistry = Readonly<Record<CliId, AgentAdapter>>;

/** Build a fresh agent registry, primarily for tests and embedded hosts. */
export function createAgentRegistry(options: CliAdapterOptions = {}): AgentRegistry {
  const clis = createCliAdapters(options);

  return Object.freeze({
    codex: createCodexAdapter(clis.codex),
    claude: createClaudeAdapter(clis.claude),
    pi: createAgentAdapter(clis.pi),
    omp: createAgentAdapter(clis.omp),
  });
}

/** Default registry derived from the current user's home and environment. */
export const AGENT_REGISTRY: AgentRegistry = createAgentRegistry();

export function getAgentAdapter(id: string, options?: CliAdapterOptions): AgentAdapter | null {
  if (!isAgentId(id)) {
    return null;
  }

  const registry = options ? createAgentRegistry(options) : AGENT_REGISTRY;
  return registry[id];
}

export function isAgentId(value: string): value is CliId {
  return (CLI_IDS as readonly string[]).includes(value);
}

export { CLI_IDS };
