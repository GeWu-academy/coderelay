import type { Config, RouteRule, RoutingMode } from "../config/schema";
import { CLI_IDS } from "../models/cli";
import { formatModelRef, parseModelRef } from "../models/types";
import { matchRules, ruleMatchesCandidate } from "./rules";
import {
  compareScores,
  scoreCandidate,
  scoreCandidates,
  toModelCost,
} from "./scorer";
import {
  RouteError,
  type RouteCandidate,
  type RouteDecision,
  type RouteOptions,
  type RouteRequest,
  type ScoredCandidate,
} from "./types";

function configuredAgentIds(config: Config): string[] {
  return Object.entries(config.agents)
    .filter(([, agent]) => agent.enabled)
    .map(([id]) => id);
}

function candidateForModel(
  config: Config,
  agentId: string,
  model:
    | {
        id: string;
        label?: string;
        strengths: string[];
        cost?: number;
        contextWindow?: number;
        default?: boolean;
      }
    | undefined,
  defaultModel: ReturnType<typeof parseModelRef>,
): RouteCandidate {
  const modelId = model?.id;
  const defaultAgent = config.defaultAgent;
  const isTopLevelDefault =
    agentId === defaultAgent &&
    (defaultModel.agent === undefined || defaultModel.agent === agentId) &&
    (modelId === undefined || defaultModel.model === modelId);
  const strengths = (model?.strengths ?? []).filter(
    (strength): strength is RouteCandidate["strengths"][number] =>
      typeof strength === "string",
  );

  return {
    agent: agentId,
    model: modelId,
    label: model?.label,
    strengths,
    cost: toModelCost(model?.cost),
    contextWindow: model?.contextWindow,
    isDefault: isTopLevelDefault || (agentId === defaultAgent && model?.default === true),
  };
}

function dedupeCandidates(
  candidates: readonly RouteCandidate[],
): RouteCandidate[] {
  const seen = new Set<string>();
  const result: RouteCandidate[] = [];

  for (const candidate of candidates) {
    const key = candidate.model
      ? formatModelRef(candidate.agent, candidate.model)
      : candidate.agent;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }

  return result;
}

/** Build selectable candidates from config and the set of available agents. */
export function buildRouteCandidates(
  config: Config,
  options: Pick<RouteOptions, "availableAgents"> = {},
): RouteCandidate[] {
  const available = options.availableAgents
    ? new Set(options.availableAgents)
    : null;
  const ids = [...new Set([
    ...(options.availableAgents ?? CLI_IDS),
    config.defaultAgent,
  ])];
  const defaultModel = config.defaultModel
    ? parseModelRef(config.defaultModel, config.defaultAgent)
    : { agent: config.defaultAgent, model: "" };
  const candidates: RouteCandidate[] = [];

  for (const agentId of ids) {
    if (available && !available.has(agentId)) {
      continue;
    }

    const agent = config.agents[agentId];
    if (agent && !agent.enabled) {
      continue;
    }

    if (agent && agent.models.length > 0) {
      candidates.push(
        ...agent.models.map((model) =>
          candidateForModel(config, agentId, model, defaultModel),
        ),
      );
      continue;
    }

    const fallbackModel =
      defaultModel.agent === agentId && defaultModel.model
        ? {
            id: defaultModel.model,
            strengths: [],
            contextWindow: undefined,
            default: true,
          }
        : undefined;

    candidates.push(
      candidateForModel(config, agentId, fallbackModel, defaultModel),
    );
  }

  return dedupeCandidates(candidates);
}

function defaultCandidate(
  candidates: readonly RouteCandidate[],
): RouteCandidate {
  return (
    candidates.find((candidate) => candidate.isDefault) ??
    candidates[0] ??
    (() => {
      throw new RouteError("no route candidates are available");
    })()
  );
}

function decisionFromScore(
  strategy: RouteDecision["strategy"],
  scored: ScoredCandidate,
  matchedRule?: RouteRule,
): RouteDecision {
  return {
    agent: scored.candidate.agent,
    model: scored.candidate.model,
    candidate: scored.candidate,
    strategy,
    score: scored.score,
    ruleMatches: scored.ruleMatches,
    reasons:
      scored.reasons.length > 0
        ? scored.reasons
        : ["fallback target"],
    matchedRule,
  };
}

function routeWithRules(
  request: RouteRequest,
  config: Config,
  candidates: readonly RouteCandidate[],
): RouteDecision {
  const matches = matchRules(request, config.routing.rules);

  for (const match of matches) {
    const matchingCandidates = candidates.filter((candidate) =>
      ruleMatchesCandidate(match.rule, candidate),
    );

    if (matchingCandidates.length === 0) {
      const target = [match.rule.use.agent, match.rule.use.model]
        .filter(Boolean)
        .join(":");
      throw new RouteError(
        `rule "${match.rule.name}" matched, but target "${target}" is not available; refusing silent fallback`,
      );
    }

    const [best] = scoreCandidates(
      request,
      matchingCandidates,
      config.routing.weights,
      [match.rule],
    ).sort(compareScores);

    if (best) {
      return decisionFromScore("rules", best, match.rule);
    }
  }

  const [fallback] = scoreCandidates(
    request,
    [defaultCandidate(candidates)],
    config.routing.weights,
    [],
  );

  if (!fallback) {
    throw new RouteError("no route candidates are available");
  }

  return decisionFromScore("rules", fallback);
}

function routeByScore(
  request: RouteRequest,
  config: Config,
  candidates: readonly RouteCandidate[],
  strategy: "score" | "hybrid",
): RouteDecision {
  const rules =
    strategy === "hybrid" ? config.routing.rules : ([] as RouteRule[]);
  const [best] = scoreCandidates(
    request,
    candidates,
    config.routing.weights,
    rules,
  ).sort(compareScores);

  if (!best) {
    throw new RouteError("no route candidates are available");
  }

  const matchedRule =
    strategy === "hybrid" && best.ruleMatches.length > 0
      ? best.ruleMatches[0]?.rule
      : undefined;

  return decisionFromScore(strategy, best, matchedRule);
}

/** Select an agent/model pair according to the configured strategy. */
export function route(
  request: RouteRequest,
  config: Config,
  options: RouteOptions = {},
): RouteDecision {
  const candidates =
    options.candidates ??
    buildRouteCandidates(config, options);

  if (candidates.length === 0) {
    throw new RouteError("no route candidates are available");
  }

  switch (config.routing.strategy) {
    case "rules":
      return routeWithRules(request, config, candidates);
    case "score":
      return routeByScore(request, config, candidates, "score");
    case "hybrid":
      return routeByScore(request, config, candidates, "hybrid");
  }
}

/** Select an explicitly requested agent/model without applying routing. */
export function selectCandidate(
  candidates: readonly RouteCandidate[],
  agent?: string,
  model?: string,
): RouteCandidate {
  const matched = candidates.filter(
    (candidate) =>
      (!agent || candidate.agent === agent) &&
      (!model || candidate.model === model),
  );

  const candidate = matched.find((item) => item.isDefault) ?? matched[0];
  if (candidate) {
    return candidate;
  }

  throw new RouteError(
    `no candidate matches ${[agent, model].filter(Boolean).join(":")}`,
  );
}

/**
 * Resolve effective routing mode:
 * Explicit user override takes precedence over workspace configuration.
 */
export function resolveRoutingMode(
  configMode: RoutingMode,
  override?: RoutingMode | null,
): RoutingMode {
  return override ?? configMode;
}

export { scoreCandidate };
