/**
 * Model-level types shared by the router, the adapters and the CLI.
 *
 * A "model" always belongs to an agent: the agent knows how to launch a
 * process, the model is the string that gets handed to that process
 * (for example `gpt-5-codex` for the Codex CLI or `sonnet` for Claude Code).
 */

/** Identifier of an agent, e.g. `codex` or `claude`. */
export type AgentId = string;

/** Capabilities a model can be good at; used as routing signals. */
export type ModelStrength =
  | "coding"
  | "reasoning"
  | "long-context"
  | "tool-use"
  | "fast"
  | "cheap"
  | "creative"
  | "multimodal";

export const MODEL_STRENGTHS: readonly ModelStrength[] = [
  "coding",
  "reasoning",
  "long-context",
  "tool-use",
  "fast",
  "cheap",
  "creative",
  "multimodal",
];

/** Relative cost bucket, 1 (cheapest) to 5 (most expensive). */
export type ModelCost = 1 | 2 | 3 | 4 | 5;

export interface ModelInfo {
  /** Model id understood by the agent CLI (`--model <id>`). */
  id: string;
  /** Human readable name used in listings. */
  label: string;
  /** Agent that owns this model. */
  agent: AgentId;
  /** Routing strengths used by the scorer. */
  strengths: ModelStrength[];
  description?: string;
  contextWindow?: number;
  cost?: ModelCost;
  /** Model used when the user does not pick one for this agent. */
  default?: boolean;
}

/** `agent:model` reference used by `--model` and rule definitions. */
export interface AgentModelRef {
  agent?: AgentId;
  model: string;
}

/**
 * Parse a model reference.
 *
 * Accepts `model` or `agent:model`. Passing `defaultAgent` lets the caller
 * resolve `agent:model` references that omit the agent.
 */
export function parseModelRef(ref: string, defaultAgent?: AgentId): AgentModelRef {
  const separator = ref.indexOf(":");
  if (separator <= 0) {
    return { agent: defaultAgent, model: ref };
  }
  return {
    agent: ref.slice(0, separator),
    model: ref.slice(separator + 1),
  };
}

/** Render a model as `agent:model`. */
export function formatModelRef(agent: AgentId, model: string): string {
  return `${agent}:${model}`;
}
