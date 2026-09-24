import { join, resolve } from "node:path";

import { z } from "zod";

import type { AgentId } from "../models/types";
import type { RouteCandidate, RouteDecision, RouteRequest } from "./types";

export const TYPESAFE_DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const TYPESAFE_DEFAULT_MODEL = "jev-latest";
export const TYPESAFE_ENV_KEY = "TYPESAFE_API_KEY";

const CANDIDATE_ENV_FILES = [
  ".env.local",
  "env.local",
  ".env",
] as const;

export class JevError extends Error {
  readonly code:
    | "NO_KEY"
    | "NO_CANDIDATES"
    | "TIMEOUT"
    | "HTTP_ERROR"
    | "INVALID_RESPONSE"
    | "INVALID_CHOICE"
    | "NO_CHOICE";
  readonly status?: number;

  constructor(
    message: string,
    options: {
      code:
        | "NO_KEY"
        | "NO_CANDIDATES"
        | "TIMEOUT"
        | "HTTP_ERROR"
        | "INVALID_RESPONSE"
        | "INVALID_CHOICE"
        | "NO_CHOICE";
      status?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "JevError";
    this.code = options.code;
    this.status = options.status;
  }
}

export interface JevQuestionChoice {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Record<string, string | null>;
}

export interface JevRequestBody {
  readonly state: string | Record<string, unknown>;
  readonly model: string;
  readonly questions: Record<string, JevQuestionChoice>;
}

export const JevChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
});

export type JevChoiceAnswer = z.infer<typeof JevChoiceAnswerSchema>;

export const JevUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
});

export type JevUsage = z.infer<typeof JevUsageSchema>;

// ponytail: validates choice answers only; upgrade to discriminated union when jev supports other question types
export const JevResponseBodySchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), JevChoiceAnswerSchema.optional()),
  usage: JevUsageSchema.nullish(),
});

export type JevResponseBody = z.infer<typeof JevResponseBodySchema>;

export interface JevClientOptions {
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetchFn?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  readonly cwd?: string;
}

export interface JevDecision {
  readonly agent: AgentId;
  readonly model?: string;
  readonly candidate: RouteCandidate;
  readonly confidence: number;
  readonly probabilities: Record<string, number>;
  readonly rawChoice: string;
  readonly modelName: string;
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

/** Formats a route candidate into a distinct choice identifier. */
export function formatCandidateKey(candidate: RouteCandidate): string {
  return candidate.model ? `${candidate.agent}:${candidate.model}` : candidate.agent;
}

/**
 * Resolves the TypeSafe API key in order of priority:
 * 1. Explicitly supplied key
 * 2. process.env.TYPESAFE_API_KEY
 * 3. Local env files (.env.local, env.local, .env) in cwd
 */
export async function resolveTypesafeApiKey(
  options: { explicitKey?: string; cwd?: string } = {},
): Promise<string | null> {
  const explicit = options.explicitKey?.trim();
  if (explicit) {
    return explicit;
  }

  const envKey = process.env[TYPESAFE_ENV_KEY]?.trim();
  if (envKey) {
    return envKey;
  }

  const baseDir = resolve(options.cwd ?? process.cwd());
  for (const fileName of CANDIDATE_ENV_FILES) {
    const filePath = join(baseDir, fileName);
    try {
      const file = Bun.file(filePath);
      if (await file.exists()) {
        const text = await file.text();
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) {
            continue;
          }
          const eqIndex = trimmed.indexOf("=");
          if (eqIndex === -1) {
            continue;
          }
          const key = trimmed.slice(0, eqIndex).trim();
          if (key === TYPESAFE_ENV_KEY) {
            const val = trimmed.slice(eqIndex + 1).trim();
            const unquoted = val.replace(/^["']|["']$/g, "").trim();
            if (unquoted) {
              return unquoted;
            }
          }
        }
      }
    } catch {
      // Ignore filesystem read errors and check next candidate file.
    }
  }

  return null;
}

/** Build the structured Jev systemone request body from candidates. */
export function buildJevRequest(
  request: RouteRequest,
  candidates: readonly RouteCandidate[],
  model = TYPESAFE_DEFAULT_MODEL,
): JevRequestBody {
  const criteria: Record<string, string> = {};

  for (const candidate of candidates) {
    const key = formatCandidateKey(candidate);
    const parts: string[] = [];

    if (candidate.label) {
      parts.push(candidate.label);
    }
    if (candidate.strengths.length > 0) {
      parts.push(`strengths: ${candidate.strengths.join(", ")}`);
    }
    if (candidate.cost !== undefined) {
      parts.push(`cost: ${candidate.cost}/5`);
    }
    if (candidate.contextWindow !== undefined) {
      parts.push(`context window: ${candidate.contextWindow} tokens`);
    }
    if (candidate.isDefault) {
      parts.push("default agent");
    }

    criteria[key] = parts.length > 0 ? parts.join("; ") : candidate.agent;
  }

  return {
    state: [
      request.prompt,
      request.language ? `Language: ${request.language}` : undefined,
      request.files?.length ? `Files: ${request.files.join(", ")}` : undefined,
      request.contextSize !== undefined ? `Context size: ${request.contextSize} tokens` : undefined,
      request.requiredStrengths?.length ? `Required strengths: ${request.requiredStrengths.join(", ")}` : undefined,
    ].filter((part): part is string => part !== undefined).join("\n"),
    model,
    questions: {
      decision: {
        type: "choice",
        instructions:
          "Select the single most suitable coding agent or model for this coding task.",
        criteria,
      },
    },
  };
}

/**
 * Routes a request using the TypeSafe Jev System One model.
 * Never falls back to local heuristic routing: raises JevError on failure.
 */
export async function routeWithJev(
  request: RouteRequest,
  candidates: readonly RouteCandidate[],
  options: JevClientOptions = {},
): Promise<JevDecision> {
  if (candidates.length === 0) {
    throw new JevError("no route candidates available for Jev decision", {
      code: "NO_CANDIDATES",
    });
  }

  const apiKey = await resolveTypesafeApiKey({
    explicitKey: options.apiKey,
    cwd: options.cwd,
  });

  if (!apiKey) {
    throw new JevError(
      "TYPESAFE_API_KEY is not configured (check .env.local or set TYPESAFE_API_KEY)",
      { code: "NO_KEY" },
    );
  }

  const endpoint = options.endpoint ?? TYPESAFE_DEFAULT_ENDPOINT;
  const model = options.model ?? TYPESAFE_DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? 5000;
  const fetcher = options.fetchFn ?? fetch;

  const payload = buildJevRequest(request, candidates, model);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new JevError(`Jev request timed out after ${timeoutMs}ms`, {
        code: "TIMEOUT",
        cause: error,
      });
    }
    throw new JevError(
      `failed to connect to TypeSafe API: ${error instanceof Error ? error.message : String(error)}`,
      { code: "HTTP_ERROR", cause: error },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new JevError(
      `TypeSafe API returned HTTP ${response.status}: ${errorText || response.statusText}`,
      { code: "HTTP_ERROR", status: response.status },
    );
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (error) {
    throw new JevError("failed to parse Jev API response as JSON", {
      code: "INVALID_RESPONSE",
      cause: error,
    });
  }

  const parsed = JevResponseBodySchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new JevError(
      `invalid Jev API response structure: ${parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join(", ")}`,
      {
        code: "INVALID_RESPONSE",
        cause: parsed.error,
      },
    );
  }

  const body = parsed.data;

  const answer = body.answers.decision;
  if (!answer || !answer.choice) {
    throw new JevError("Jev API response missing 'decision' answer", {
      code: "NO_CHOICE",
    });
  }

  const chosenKey = answer.choice;
  const candidate = candidates.find(
    (item) => formatCandidateKey(item) === chosenKey,
  );

  if (!candidate) {
    throw new JevError(
      `Jev API returned unknown choice '${chosenKey}' (candidates: ${candidates
        .map((item) => formatCandidateKey(item))
        .join(", ")})`,
      { code: "INVALID_CHOICE" },
    );
  }

  return {
    agent: candidate.agent,
    model: candidate.model,
    candidate,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    rawChoice: chosenKey,
    modelName: body.model || model,
    usage: body.usage
      ? {
          inputTokens: body.usage.input_tokens,
          outputTokens: body.usage.output_tokens,
        }
      : undefined,
  };
}

/** Convert a JevDecision to the project's standard RouteDecision. */
export function jevDecisionToRouteDecision(
  decision: JevDecision,
): RouteDecision {
  const percent = Math.round(decision.confidence * 100);
  return {
    agent: decision.agent,
    model: decision.model,
    candidate: decision.candidate,
    strategy: "jev",
    score: decision.confidence,
    ruleMatches: [],
    reasons: [
      `Jev model decision: ${decision.rawChoice} (${percent}% confidence, model: ${decision.modelName})`,
    ],
  };
}
