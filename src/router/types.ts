import type { RouteRule } from "../config/schema";
import type {
  AgentId,
  ModelCost,
  ModelStrength,
} from "../models/types";

export type RoutingStrategy = "rules" | "score" | "hybrid" | "jev";
export type RoutingMode = "local" | "manual" | "jev";

/** Input signals used to select an agent/model pair. */
export interface RouteRequest {
  readonly prompt: string;
  readonly files?: readonly string[];
  readonly language?: string;
  /** Approximate context size in tokens, when known by the caller. */
  readonly contextSize?: number;
  /** Explicit strengths requested by a caller. */
  readonly requiredStrengths?: readonly ModelStrength[];
}

/** One selectable agent/model pair produced from configuration. */
export interface RouteCandidate {
  readonly agent: AgentId;
  readonly model?: string;
  readonly label?: string;
  readonly strengths: readonly ModelStrength[];
  readonly cost?: ModelCost;
  readonly contextWindow?: number;
  readonly isDefault: boolean;
}

export interface RuleMatch {
  readonly rule: RouteRule;
  readonly reason: string;
}

export interface ScoredCandidate {
  readonly candidate: RouteCandidate;
  readonly score: number;
  readonly ruleMatches: readonly RuleMatch[];
  readonly reasons: readonly string[];
}

export interface RouteDecision {
  readonly agent: AgentId;
  readonly model?: string;
  readonly candidate: RouteCandidate;
  readonly strategy: RoutingStrategy;
  readonly score: number;
  readonly ruleMatches: readonly RuleMatch[];
  readonly reasons: readonly string[];
  readonly matchedRule?: RouteRule;
}

export interface RouteOptions {
  /** Restrict routing to agents that are installed and supported. */
  readonly availableAgents?: readonly AgentId[];
  /** Supply precomputed candidates instead of deriving them from config. */
  readonly candidates?: readonly RouteCandidate[];
}

export class RouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteError";
  }
}
