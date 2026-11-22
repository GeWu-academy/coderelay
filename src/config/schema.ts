/**
 * Zod schema for `.coderelay/config.yaml`.
 *
 * The schema is the single source of truth for the config shape: the loader
 * validates with it, the CLI types come from `z.infer`, and `doctor` reports
 * validation problems through it.
 */

import { z } from "zod";

import { CLI_IDS, type CliId } from "../models/cli";
import { MODEL_STRENGTHS, parseModelRef } from "../models/types";

export const isAgentId = (value: string): value is CliId =>
  (CLI_IDS as readonly string[]).includes(value);

const isRegExp = (value: string): boolean => {
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
};

export const ModelConfigSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "model id must not be empty")
    .describe("Model id passed to the agent CLI"),
  label: z.string().optional(),
  strengths: z.array(z.enum(MODEL_STRENGTHS)).default([]),
  description: z.string().optional(),
  contextWindow: z.number().int().positive("contextWindow must be positive").optional(),
  cost: z
    .number()
    .int()
    .min(1, "cost must be between 1 and 5")
    .max(5, "cost must be between 1 and 5")
    .optional(),
  default: z.boolean().optional(),
});

export const AgentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * Whether the user has explicitly decided this agent's activation state.
   * `enabled` defaults to `true`, so it cannot distinguish "never asked" from
   * "user turned it on"; this flag records that the question was answered.
   */
  activationDecided: z.boolean().default(false),
  /** Override the binary, for example `/opt/homebrew/bin/codex`. */
  command: z.string().trim().min(1, "command must not be empty").optional(),
  /** Models exposed by this agent; empty means the adapter default. */
  models: z.array(ModelConfigSchema).default([]),
  /** Extra argv appended before the prompt. */
  extraArgs: z.array(z.string()).default([]),
  /** Extra environment variables for the child process. */
  env: z.record(z.string(), z.string()).default({}),
});

export const RuleWhenSchema = z
  .object({
    /** Any of these keywords found in the prompt triggers the rule. */
    keywords: z.array(z.string().min(1)).optional(),
    /** Any of these regular expressions matching the prompt triggers the rule. */
    patterns: z.array(z.string().refine(isRegExp, "must be a valid regular expression")).optional(),
    /** Languages (`--lang`) that trigger the rule. */
    languages: z.array(z.string().min(1)).optional(),
    /** Any of these globs matching a request file triggers the rule. */
    files: z.array(z.string().min(1)).optional(),
    minPromptLength: z
      .number()
      .int()
      .nonnegative("minPromptLength must be non-negative")
      .optional(),
    maxPromptLength: z
      .number()
      .int()
      .nonnegative("maxPromptLength must be non-negative")
      .optional(),
  })
  .refine(
    (data) =>
      data.minPromptLength === undefined ||
      data.maxPromptLength === undefined ||
      data.minPromptLength <= data.maxPromptLength,
    {
      message: "minPromptLength cannot be greater than maxPromptLength",
      path: ["minPromptLength"],
    },
  );

export const RuleUseSchema = z
  .object({
    agent: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
  })
  .refine((data) => Boolean(data.agent || data.model), {
    message: "must specify at least an agent or a model in 'use'",
  });

export const RouteRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** Higher priority rules are evaluated first and win ties. */
  priority: z.number().int().default(0),
  /** Omitted `when` matches every request (catch-all rule). */
  when: RuleWhenSchema.optional(),
  use: RuleUseSchema,
  /** Score bonus applied to the target in `hybrid`/`score` strategies. */
  score: z.number().default(10),
});

export const RoutingWeightsSchema = z.object({
  /** Weight per matched model strength. */
  strength: z.number().min(0, "weight must be non-negative").default(1),
  /** Multiplier applied to a matched rule's `score` bonus. */
  rule: z.number().min(0, "weight must be non-negative").default(1),
  /** Bonus for the configured default agent/model. */
  default: z.number().min(0, "weight must be non-negative").default(2),
  /** Penalty per cost bucket above 1. */
  cost: z.number().min(0, "weight must be non-negative").default(0.5),
  /** Bonus for models strong at long context when the request is large. */
  context: z.number().min(0, "weight must be non-negative").default(1),
});

export const ROUTING_MODES = ["local", "manual", "jev"] as const;
export type RoutingMode = (typeof ROUTING_MODES)[number];

export const RoutingConfigSchema = z.object({
  mode: z.enum(ROUTING_MODES).default("local"),
  strategy: z.enum(["rules", "score", "hybrid"]).default("hybrid"),
  typesafeApiKey: z.string().optional(),
  typesafeEndpoint: z.string().optional(),
  rules: z.array(RouteRuleSchema).default([]),
  weights: RoutingWeightsSchema.default({
    strength: 1,
    rule: 1,
    default: 2,
    cost: 0.5,
    context: 1,
  }),
});

const BaseConfigSchema = z.object({
  /** Bump when the config format changes in a breaking way. */
  version: z.literal(1).default(1),
  /** Agent used when scoring has no clear winner. */
  defaultAgent: z.string().default("codex"),
  /** Optional default model for `defaultAgent`; falls back to the agent default. */
  defaultModel: z.string().optional(),
  agents: z.record(z.string(), AgentConfigSchema).default({}),
  routing: RoutingConfigSchema.default({
    mode: "local",
    strategy: "hybrid",
    rules: [],
    weights: {
      strength: 1,
      rule: 1,
      default: 2,
      cost: 0.5,
      context: 1,
    },
  }),
});

export const ConfigSchema = BaseConfigSchema.superRefine((config, ctx) => {
  if (!isAgentId(config.defaultAgent)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `unsupported defaultAgent "${config.defaultAgent}": must be one of: ${CLI_IDS.join(", ")}`,
      path: ["defaultAgent"],
    });
  } else {
    const hasEnabledAgent = Object.entries(config.agents).some(
      ([id, a]) => isAgentId(id) && a.enabled !== false,
    );
    if (hasEnabledAgent && config.agents[config.defaultAgent]?.enabled === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `defaultAgent "${config.defaultAgent}" is disabled; choose an enabled agent as defaultAgent`,
        path: ["defaultAgent"],
      });
    }
  }

  for (const agentId of Object.keys(config.agents)) {
    if (!isAgentId(agentId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unsupported agent id "${agentId}" in agents: must be one of: ${CLI_IDS.join(", ")}`,
        path: ["agents", agentId],
      });
      continue;
    }
    const agent = config.agents[agentId];
    if (!agent) {
      continue;
    }

    const seenModelIds = new Set<string>();
    for (const [i, model] of agent.models.entries()) {
      if (seenModelIds.has(model.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate model id "${model.id}" in agent "${agentId}"`,
          path: ["agents", agentId, "models", i, "id"],
        });
      }
      seenModelIds.add(model.id);
    }

    const defaultModels = agent.models.filter((m) => m.default);
    if (defaultModels.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `agent "${agentId}" has multiple default models: ${defaultModels.map((m) => m.id).join(", ")}`,
        path: ["agents", agentId, "models"],
      });
    }
  }

  if (config.defaultModel !== undefined) {
    const trimmed = config.defaultModel.trim();
    if (!trimmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "defaultModel must not be empty",
        path: ["defaultModel"],
      });
    } else {
      const ref = parseModelRef(trimmed, config.defaultAgent);
      if (!ref.model) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "defaultModel model id must not be empty",
          path: ["defaultModel"],
        });
      } else if (ref.agent && ref.agent !== config.defaultAgent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `defaultModel must target defaultAgent "${config.defaultAgent}", got "${ref.agent}"`,
          path: ["defaultModel"],
        });
      } else if (ref.agent && isAgentId(ref.agent)) {
        const targetAgent = config.agents[ref.agent];
        if (targetAgent && targetAgent.models.length > 0) {
          const hasModel = targetAgent.models.some((m) => m.id === ref.model);
          if (!hasModel) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `model is not configured for ${ref.agent}: ${ref.model}`,
              path: ["defaultModel"],
            });
          }
        }
      }
    }
  }

  config.routing.rules.forEach((rule, index) => {
    const rulePath = ["routing", "rules", index];
    const requestedAgent = rule.use.agent;

    if (requestedAgent) {
      if (!isAgentId(requestedAgent)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown agent in rule "${rule.name}": "${requestedAgent}"; must be one of: ${CLI_IDS.join(", ")}`,
          path: [...rulePath, "use", "agent"],
        });
      } else if (config.agents[requestedAgent]?.enabled === false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `disabled agent in rule "${rule.name}": "${requestedAgent}"`,
          path: [...rulePath, "use", "agent"],
        });
      }
    }

    if (rule.use.model) {
      if (requestedAgent && isAgentId(requestedAgent)) {
        const agent = config.agents[requestedAgent];
        if (
          agent &&
          agent.models.length > 0 &&
          !agent.models.some((m) => m.id === rule.use.model)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `model is not configured for ${requestedAgent}: ${rule.use.model} (in rule "${rule.name}")`,
            path: [...rulePath, "use", "model"],
          });
        }
      } else if (!requestedAgent) {
        const enabledAgentsWithModels = Object.entries(config.agents).filter(
          ([id, a]) => isAgentId(id) && a.enabled !== false && a.models.length > 0,
        );
        if (enabledAgentsWithModels.length > 0) {
          const found = enabledAgentsWithModels.some(([, a]) =>
            a.models.some((m) => m.id === rule.use.model),
          );
          if (!found) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `model is not configured for any enabled agent: ${rule.use.model} (in rule "${rule.name}")`,
              path: [...rulePath, "use", "model"],
            });
          }
        }
      }
    }
  });
});

export type Config = z.infer<typeof ConfigSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type RouteRule = z.infer<typeof RouteRuleSchema>;
export type RuleWhen = z.infer<typeof RuleWhenSchema>;
export type RuleUse = z.infer<typeof RuleUseSchema>;
export type RoutingConfig = z.infer<typeof RoutingConfigSchema>;
export type RoutingWeights = z.infer<typeof RoutingWeightsSchema>;

/** A fully-populated config containing only defaults. */
export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}
