/**
 * 模型目录 / 探测层：prompt 提交后对已安装且启用的 CLI 并行探测，
 * 以 CLI 原生配置为事实来源；`.coderelay/config.yaml` 只叠加元数据，
 * 不能伪造 CLI 实际不存在的模型。
 */
import type { Config } from "../config/schema";
import {
  CLI_IDS,
  type CliAdapter,
  type CliId,
  type DetectedCli,
} from "../models/cli";
import type { CliCapabilities, ProbeResult } from "./capabilities";
import {
  MODEL_STRENGTHS,
  parseModelRef,
  type ModelStrength,
} from "../models/types";
import type { RouteCandidate } from "../router/types";
import { toModelCost } from "../router/scorer";

export type ProbeDisplayStatus =
  | "scanning"
  | "found"
  | "unprobed"
  | "not-installed"
  | "disabled";

/** 统一模型选择器的一行：CLI + 模型 + 元数据 + 可用性。 */
export interface ModelOption {
  readonly cliId: CliId;
  readonly modelId: string;
  readonly label: string;
  readonly description?: string;
  readonly isDefault: boolean;
  readonly capabilities: CliCapabilities;
  readonly strengths: readonly ModelStrength[];
  readonly cost?: number;
  readonly contextWindow?: number;
  readonly available: boolean;
  /** 不可用时的具体原因；可用时为 undefined。 */
  readonly reason?: string;
}

export interface ProbeDisplay {
  readonly cliId: CliId;
  readonly status: ProbeDisplayStatus;
  readonly models: readonly ModelOption[];
  readonly reason?: string;
}

export interface ModelCatalog {
  readonly probes: readonly ProbeDisplay[];
  readonly options: readonly ModelOption[];
}

function detectedFor(
  detected: readonly DetectedCli[],
  id: CliId,
): DetectedCli | undefined {
  return detected.find((item) => item.id === id);
}

function isStrength(value: unknown): value is ModelStrength {
  return (MODEL_STRENGTHS as readonly unknown[]).includes(value);
}

function configStrengths(
  config: Config,
  cliId: CliId,
  modelId: string,
): readonly ModelStrength[] {
  const entry = config.agents[cliId]?.models.find((m) => m.id === modelId);
  return (entry?.strengths ?? []).filter(isStrength);
}

/**
 * 并行探测所有 CLI 的模型/能力。调用方传入已扫描的安装状态与适配器；
 * 未安装 / 未启用 / 探测失败的 CLI 标记原因且不产生可用候选。
 */
export async function probeModelCatalog(
  detected: readonly DetectedCli[],
  adapters: Readonly<Record<CliId, CliAdapter>>,
  config: Config,
): Promise<ModelCatalog> {
  const defaultRef = config.defaultModel
    ? parseModelRef(config.defaultModel, config.defaultAgent)
    : undefined;

  const probes = await Promise.all(
    CLI_IDS.map(async (cliId): Promise<ProbeDisplay> => {
      const agentConfig = config.agents[cliId];
      if (agentConfig?.enabled === false) {
        return { cliId, status: "disabled", models: [], reason: "已在配置中禁用" };
      }
      const found = detectedFor(detected, cliId);
      if (!found?.available) {
        return { cliId, status: "not-installed", models: [], reason: "未安装" };
      }
      const adapter = adapters[cliId];
      if (!adapter?.probeModels) {
        return {
          cliId,
          status: "unprobed",
          models: [],
          reason: "该 CLI 暂不支持模型探测，禁止执行",
        };
      }
      let result: ProbeResult;
      try {
        result = await adapter.probeModels();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { cliId, status: "unprobed", models: [], reason: message };
      }
      if (!result.ok) {
        return { cliId, status: "unprobed", models: [], reason: result.reason };
      }
      const models: ModelOption[] = result.models.map((model) => {
        const override = agentConfig?.models.find((m) => m.id === model.id);
        const isTopDefault =
          defaultRef !== undefined &&
          defaultRef.agent === cliId &&
          defaultRef.model === model.id;
        return {
          cliId,
          modelId: model.id,
          label: override?.label ?? model.label ?? model.id,
          description: override?.description ?? model.description,
          isDefault: isTopDefault || override?.default === true || (cliId === config.defaultAgent && model.isDefault === true),
          capabilities: result.capabilities,
          strengths: configStrengths(config, cliId, model.id),
          cost: override?.cost,
          contextWindow: override?.contextWindow,
          available: true,
        };
      });
      return { cliId, status: "found", models };
    }),
  );

  // 配置排序：按 agents[cli].models 数组顺序排同 CLI 内模型；不新增模型。
  const orderOf = (cliId: CliId, modelId: string): number => {
    const index = config.agents[cliId]?.models.findIndex((m) => m.id === modelId) ?? -1;
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const options = probes
    .flatMap((probe) => [...probe.models])
    .sort((a, b) => {
      const order = orderOf(a.cliId, a.modelId) - orderOf(b.cliId, b.modelId);
      if (order !== 0) {
        return order;
      }
      if (a.cliId === b.cliId) {
        return a.modelId.localeCompare(b.modelId);
      }
      return CLI_IDS.indexOf(a.cliId) - CLI_IDS.indexOf(b.cliId);
    });

  return { probes, options };
}

/**
 * `--agent` / `--model` 显式选择校验：必须经过已安装、已启用、已探测校验。
 * 失败时抛出可读错误（含具体原因），不静默回退。
 */
export function validateExplicitTarget(
  catalog: ModelCatalog,
  agent: string | undefined,
  model: string | undefined,
  defaultAgent: string,
): { readonly cliId: CliId; readonly modelId?: string } {
  const reference =
    model !== undefined
      ? parseModelRef(model, agent ?? defaultAgent)
      : agent !== undefined
        ? { agent, model: "" }
        : undefined;
  if (!reference || !reference.agent) {
    throw new Error("显式选择缺少 agent：请传入 --agent 或 agent:model 形式的 --model");
  }
  if (agent && reference.agent !== agent) {
    throw new Error(`--model 指向 ${reference.agent}，但 --agent 是 ${agent}`);
  }
  const cliId = reference.agent as CliId;
  if (!CLI_IDS.includes(cliId)) {
    throw new Error(`不支持的 agent：${reference.agent}`);
  }
  const probe = catalog.probes.find((item) => item.cliId === cliId);
  if (probe?.status === "disabled") {
    throw new Error(`agent 已禁用：${cliId}`);
  }
  if (probe?.status === "not-installed") {
    throw new Error(`agent 未安装：${cliId}；请先安装对应 CLI`);
  }
  if (probe?.status !== "found") {
    throw new Error(
      `agent 无法探测模型，禁止执行：${cliId}${probe?.reason ? `（${probe.reason}）` : ""}`,
    );
  }
  const modelId = reference.model || undefined;
  if (modelId === undefined) {
    return { cliId };
  }
  const found = probe.models.find((option) => option.modelId === modelId);
  if (!found) {
    const known = probe.models.map((option) => option.modelId).join("、") || "（空）";
    throw new Error(
      `模型不存在于 ${cliId} 的本机配置：${modelId}；已探测到：${known}`,
    );
  }
  return { cliId, modelId };
}

/** 路由器输入：已探测模型候选 + 配置元数据（rules/score/hybrid 策略不变）。 */
export function toRouteCandidates(
  catalog: ModelCatalog,
  config: Config,
): RouteCandidate[] {
  const defaultRef = config.defaultModel
    ? parseModelRef(config.defaultModel, config.defaultAgent)
    : undefined;
  return catalog.options
    .filter((option) => option.available)
    .map((option): RouteCandidate => {
      const isTopDefault =
        defaultRef !== undefined &&
        option.cliId === defaultRef.agent &&
        option.modelId === defaultRef.model;
      return {
        agent: option.cliId,
        model: option.modelId,
        label: option.label,
        strengths: option.strengths,
        cost: toModelCost(option.cost),
        contextWindow: option.contextWindow,
        isDefault: isTopDefault || option.isDefault,
      };
    });
}
