import type { RoutingWeights } from "../config/schema";
import type { ModelCost, ModelStrength } from "../models/types";
import { matchRulesForCandidate } from "./rules";
import type {
  RouteCandidate,
  RouteRequest,
  RuleMatch,
  ScoredCandidate,
} from "./types";

const STRENGTH_KEYWORDS: Readonly<Record<ModelStrength, readonly string[]>> = {
  coding: [
    "code",
    "bug",
    "refactor",
    "implement",
    "typescript",
    "javascript",
    "python",
    "rust",
    "go",
    "api",
    "test",
  ],
  reasoning: [
    "architecture",
    "design",
    "analyze",
    "reason",
    "complex",
    "tradeoff",
    "plan",
    "debug",
  ],
  "long-context": [
    "repository",
    "codebase",
    "entire project",
    "all files",
    "large context",
    "long context",
  ],
  "tool-use": [
    "run",
    "terminal",
    "command",
    "git",
    "search",
    "inspect",
    "execute",
    "file",
  ],
  fast: ["quick", "fast", "simple", "small", "typo", "brief"],
  cheap: ["cheap", "budget", "minimal", "simple"],
  creative: ["creative", "write", "story", "brainstorm", "name", "copy"],
  multimodal: ["image", "screenshot", "diagram", "vision", "photo", "video"],
};

function includesKeyword(prompt: string, keyword: string): boolean {
  const escaped = keyword
    .toLocaleLowerCase()
    .split(/\s+/u)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("\\s+");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u")
    .test(prompt.toLocaleLowerCase());
}

/** Infer model strengths from a routing request. */
export function inferStrengths(request: RouteRequest): ModelStrength[] {
  const inferred = new Set<ModelStrength>(request.requiredStrengths ?? []);

  for (const [strength, keywords] of Object.entries(STRENGTH_KEYWORDS) as [
    ModelStrength,
    readonly string[],
  ][]) {
    if (keywords.some((keyword) => includesKeyword(request.prompt, keyword))) {
      inferred.add(strength);
    }
  }

  if ((request.contextSize ?? 0) >= 100_000) {
    inferred.add("long-context");
  }

  return [...inferred];
}

function defaultBonus(
  candidate: RouteCandidate,
  weights: RoutingWeights,
): number {
  return candidate.isDefault ? weights.default : 0;
}

function strengthBonus(
  strengths: readonly ModelStrength[],
  candidate: RouteCandidate,
  weights: RoutingWeights,
): number {
  return strengths.filter((strength) =>
    candidate.strengths.includes(strength),
  ).length * weights.strength;
}

function costPenalty(
  candidate: RouteCandidate,
  weights: RoutingWeights,
): number {
  if (!candidate.cost) {
    return 0;
  }

  return (candidate.cost - 1) * weights.cost;
}

function contextBonus(
  request: RouteRequest,
  candidate: RouteCandidate,
  strengths: readonly ModelStrength[],
  weights: RoutingWeights,
): number {
  const needsLongContext =
    strengths.includes("long-context") ||
    (request.contextSize ?? 0) >= 100_000;

  const fitsRequestedContext =
    request.contextSize !== undefined &&
    candidate.contextWindow !== undefined &&
    candidate.contextWindow >= request.contextSize;
  const hasKnownTooSmallWindow =
    request.contextSize !== undefined &&
    candidate.contextWindow !== undefined &&
    candidate.contextWindow < request.contextSize;

  if (hasKnownTooSmallWindow) {
    return -weights.context;
  }
  return fitsRequestedContext ||
    (needsLongContext && candidate.strengths.includes("long-context"))
    ? weights.context
    : 0;
}

function ruleBonus(
  matches: readonly RuleMatch[],
  weights: RoutingWeights,
): number {
  const highestPriority = matches[0]?.rule.priority;
  if (highestPriority === undefined) {
    return 0;
  }
  return matches
    .filter((match) => match.rule.priority === highestPriority)
    .reduce((total, match) => total + match.rule.score * weights.rule, 0);
}

export function scoreCandidate(
  request: RouteRequest,
  candidate: RouteCandidate,
  weights: RoutingWeights,
  rules: Parameters<typeof matchRulesForCandidate>[2],
  strengths = inferStrengths(request),
): ScoredCandidate {
  const ruleMatches = matchRulesForCandidate(request, candidate, rules);
  const reasons: string[] = [];
  let score = 0;

  const defaultScore = defaultBonus(candidate, weights);
  if (defaultScore !== 0) {
    score += defaultScore;
    reasons.push("default target bonus");
  }

  const strengthScore = strengthBonus(strengths, candidate, weights);
  if (strengthScore !== 0) {
    score += strengthScore;
    reasons.push(
      `strength match: ${strengths
        .filter((strength) => candidate.strengths.includes(strength))
        .join(", ")}`,
    );
  }

  const penalty = costPenalty(candidate, weights);
  if (penalty !== 0) {
    score -= penalty;
    reasons.push("cost penalty");
  }

  const contextScore = contextBonus(
    request,
    candidate,
    strengths,
    weights,
  );
  if (contextScore !== 0) {
    score += contextScore;
    reasons.push("long-context bonus");
  }

  const scoreFromRules = ruleBonus(ruleMatches, weights);
  if (scoreFromRules !== 0) {
    score += scoreFromRules;
    reasons.push(...ruleMatches.map((match) => match.reason));
  }

  return { candidate, score, ruleMatches, reasons };
}

export function scoreCandidates(
  request: RouteRequest,
  candidates: readonly RouteCandidate[],
  weights: RoutingWeights,
  rules: Parameters<typeof matchRulesForCandidate>[2],
): ScoredCandidate[] {
  const strengths = inferStrengths(request);
  return candidates.map((candidate) =>
    scoreCandidate(request, candidate, weights, rules, strengths),
  );
}

export function compareScores(
  left: ScoredCandidate,
  right: ScoredCandidate,
): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  const leftPriority = left.ruleMatches[0]?.rule.priority ?? Number.MIN_SAFE_INTEGER;
  const rightPriority = right.ruleMatches[0]?.rule.priority ?? Number.MIN_SAFE_INTEGER;
  if (leftPriority !== rightPriority) {
    return rightPriority - leftPriority;
  }

  if (left.candidate.isDefault !== right.candidate.isDefault) {
    return left.candidate.isDefault ? -1 : 1;
  }

  return left.candidate.agent.localeCompare(right.candidate.agent);
}

export function toModelCost(value: number | undefined): ModelCost | undefined {
  if (value === undefined) {
    return undefined;
  }

  switch (value) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return value;
    default:
      return undefined;
  }
}
