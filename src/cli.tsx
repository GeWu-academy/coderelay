#!/usr/bin/env bun
import { render, type Instance } from "ink";

import { createCliAdapters, getCliAdapter } from "./agents/cli-adapters";
import {
  probeModelCatalog,
  toRouteCandidates,
  validateExplicitTarget,
  type ModelCatalog,
  type ModelOption,
  type ProbeDisplay,
} from "./agents/model-catalog";
import { isAgentId } from "./agents/registry";
import {
  activationConfirmTargets,
  activationManageTargets,
  pendingActivation,
  toActivationOptions,
  type ActivationOption,
} from "./config/activation";
import { defaultConfig, type Config, type RoutingMode } from "./config/schema";
import { loadConfig, saveActivationDecisions } from "./config/loader";
import { CLI_IDS, cliLaunchTarget, type CliId, type DetectedCli, type LaunchTarget } from "./models/cli";
import {
  summarizeEvents,
  type AgentEvent,
} from "./models/agent-events";
import type { SessionTurn, TurnContextSource } from "./models/session";
import { routeWithJev } from "./router/jev";
import { hasAmbiguousRoute, resolveRoutingMode, route } from "./router/router";
import { runAgentStream } from "./runtime/agent-run";
import { buildLaunchCmd, launchInteractive, resolveLaunchCwd } from "./runtime/launcher";
import { resolveCommand } from "./runtime/process";
import { buildPromptWithContext } from "./session/context";
import {
  createSessionStore,
  defaultSessionDbPath,
  SESSION_RETENTION,
  type SessionStore,
} from "./session/store";
import { scanCodingClis } from "./scanner/cli-scanner";
import {
  App,
  type AgentPhase,
  type LaunchRequest,
  type PhaseResult,
  type RunningTask,
} from "./ui/App";

let clis: DetectedCli[] = [];
let isScanning = true;
let initialId: CliId | undefined;
let turns: readonly SessionTurn[] = [];
let running: RunningTask | null = null;
let sessionId: string | null = null;
let store: SessionStore | undefined;
let app: Instance | undefined;

/** 统一生命周期状态（透传给 App 做状态机渲染）。 */
let phase: AgentPhase = "idle";
let probes: ProbeDisplay[] | undefined;
let modelOptions: ModelOption[] | undefined;
let lastResult: PhaseResult | null = null;
/** 激活流程：可切换的全部行 + 本次展示/保存的子集（首次确认页只含未决项）。 */
let activationOptions: readonly ActivationOption[] = [];
let activationTargets: readonly ActivationOption[] = [];
let activationMode: "confirm" | "manage" = "confirm";
/** selecting 流程携带的上下文：待执行 prompt / 探测快照 / 配置快照。 */
let pendingPrompt: string | null = null;
let pendingCatalog: ModelCatalog | null = null;
let pendingConfig: Config | null = null;
/** /model 无 prompt 选择后暂存，下次提交优先使用（用后清空，仍过校验）。 */
let manualTarget: { readonly cliId: CliId; readonly modelId?: string } | null = null;
let activeAbort: AbortController | null = null;
let flowSeq = 0;
let nativeSessionIds: Partial<Record<CliId, string>> = {};
let userModeOverride: RoutingMode | null = null;
let currentRoutingMode: RoutingMode = "local";
let currentWorkspace = process.cwd();

async function handleWorkspaceChange(newCwd: string): Promise<void> {
  try {
    process.chdir(newCwd);
    currentWorkspace = newCwd;
    userModeOverride = null;
    sessionId = null;
    turns = [];
    nativeSessionIds = {};
    manualTarget = null;
    lastResult = null;
    try {
      const config = await loadAppConfig();
      currentRoutingMode = resolveRoutingMode(config.routing.mode, userModeOverride);
    } catch {
      currentRoutingMode = resolveRoutingMode(defaultConfig().routing.mode, userModeOverride);
    }
  } catch {
    // 目录切换异常已在 UI 校验过，这里兜底
  }
  rerender();
}

function getStore(): SessionStore {
  if (!store) {
    store = createSessionStore(defaultSessionDbPath());
    try {
      store.pruneSessions(SESSION_RETENTION);
    } catch {
      // 多实例并发启动时剪枝可能遇到 SQLITE_BUSY，不应阻塞主流程。
    }
  }
  return store;
}

function scanningProbes(): ProbeDisplay[] {
  return CLI_IDS.map((cliId) => ({ cliId, status: "scanning", models: [] }));
}

function rerender(): void {
  app?.rerender(tree());
}

function tree() {
  return (
    <App
      clis={clis}
      isScanning={isScanning}
      initialId={initialId}
      turns={turns}
      running={running}
      phase={phase}
      probes={probes}
      activationOptions={
        phase === "activating" && activationTargets.length > 0
          ? activationTargets
          : undefined
      }
      activationMode={activationMode}
      onSaveActivation={(options) => {
        void handleSaveActivation(options);
      }}
      onCancelActivation={handleCancelActivation}
      onRequestActivationManager={() => {
        void requestActivationManager();
      }}
      modelOptions={phase === "selecting" ? modelOptions : undefined}
      lastResult={lastResult}
      onLaunch={(request) => {
        void launch(request);
      }}
      onAbort={handleAbort}
      onNewSession={handleNewSession}
      onRequestModelSelector={() => {
        void requestModelSelector();
      }}
      onSelectModel={(option) => {
        void handleSelectModel(option);
      }}
      onCancelSelecting={handleCancelSelecting}
      routingMode={currentRoutingMode}
      onModeChange={(mode) => {
        userModeOverride = mode;
        currentRoutingMode = mode;
        rerender();
      }}
      favoriteAgent={getStore().getFavoriteAgent()}
      onSetFavoriteAgent={(agentId) => {
        getStore().setFavoriteAgent(agentId);
        initialId = agentId;
        rerender();
      }}
      onClearFavoriteAgent={() => {
        getStore().clearFavoriteAgent();
        rerender();
      }}
      workspace={currentWorkspace}
      onWorkspaceChange={handleWorkspaceChange}
      recentWorkspaces={getStore().getRecentWorkspaces()}
      onGetRecentWorkspaces={() => getStore().getRecentWorkspaces()}
      onExit={() => {
        store?.close();
        app?.unmount();
        process.exit(0);
      }}
    />
  );
}

function waitForChildExit(
  child: ReturnType<typeof launchInteractive>,
): Promise<[number | null, NodeJS.Signals | null]> {
  return new Promise((resolve, reject) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolve([code, signal]);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      child.off("exit", onExit);
      child.off("error", onError);
    };

    child.once("exit", onExit);
    child.once("error", onError);
  });
}

function mount(): void {
  app = render(tree(), { exitOnCtrlC: false, alternateScreen: true });
}

function failTerminal(message: string, flow: number): void {
  if (flow !== flowSeq) {
    return;
  }
  running = null;
  activeAbort = null;
  phase = "failed";
  lastResult = { phase: "failed", message };
  rerender();
}

async function loadAppConfig(): Promise<Config> {
  const loaded = await loadConfig({
    cwd: currentWorkspace,
    allowMissing: true,
  });
  return loaded.config;
}

function resolveTarget(
  cliId: CliId,
  config: Config,
  bin: string,
): LaunchTarget {
  const configured = config.agents[cliId]?.command?.trim();
  if (configured) {
    const resolved = resolveCommand(configured);
    if (!resolved) {
      throw new Error(`configured command for ${cliId} was not found: ${configured}`);
    }
    return { path: resolved, runtime: "local" };
  }
  const detected = clis.find((item) => item.id === cliId);
  const scanned = detected ? cliLaunchTarget(detected) : null;
  if (scanned) {
    return scanned;
  }
  const resolved = resolveCommand(bin);
  if (resolved) {
    return { path: resolved, runtime: "local" };
  }
  throw new Error(`agent is not available: ${cliId}`);
}

function needsSelecting(catalog: ModelCatalog): boolean {
  if (catalog.probes.some((probe) => probe.status === "unprobed")) {
    return true;
  }
  return false;
}

/** 本机首次确认：只把已安装且用户还没决策过的 CLI 拿来问。 */
function enterActivationConfirm(
  detected: readonly DetectedCli[],
  config: Config,
): boolean {
  const options = toActivationOptions(detected, config);
  const pending = pendingActivation(options);
  if (pending.length === 0) {
    return false;
  }
  activationOptions = options;
  activationTargets = activationConfirmTargets(options);
  activationMode = "confirm";
  phase = "activating";
  return true;
}

/** /activate：给全部 CLI 一个入口，方便随时取消或重新启用。 */
async function requestActivationManager(): Promise<void> {
  if (
    phase === "probing" ||
    phase === "starting" ||
    phase === "running" ||
    phase === "selecting"
  ) {
    return;
  }
  flowSeq += 1;
  const flow = flowSeq;
  lastResult = null;
  let config: Config;
  try {
    config = await loadAppConfig();
  } catch (error) {
    phase = "failed";
    lastResult = {
      phase: "failed",
      message: `配置无效：${error instanceof Error ? error.message : String(error)}`,
    };
    rerender();
    return;
  }
  if (flow !== flowSeq) {
    return;
  }
  const options = toActivationOptions(clis, config);
  activationOptions = options;
  activationTargets = activationManageTargets(options);
  activationMode = "manage";
  probes = undefined;
  modelOptions = undefined;
  phase = "activating";
  rerender();
}

async function handleSaveActivation(
  options: readonly ActivationOption[],
): Promise<void> {
  if (phase !== "activating") {
    return;
  }
  // 作废在途的 prompt 流程，避免保存期间的旧流程回写界面。
  flowSeq += 1;
  try {
    // 只写本次展示过的行：其余 CLI 的配置保持原样。
    await saveActivationDecisions(
      options.map((option) => ({
        cliId: option.cliId,
        enabled: option.enabled,
      })),
    );
    if (phase !== "activating") {
      return;
    }
    await loadAppConfig();
    activationOptions = options;
    activationTargets = options;
    probes = undefined;
    modelOptions = undefined;
    phase = "idle";
    lastResult = {
      phase: "completed",
      message: `✓ 激活状态已保存：${options.filter((o) => o.enabled).length}/${options.length} 个 CLI 已激活`,
    };
    rerender();
  } catch (error) {
    if (phase !== "activating") {
      return;
    }
    // 写盘失败不能改内存状态：留在激活页让用户重试或 Esc 放弃。
    lastResult = {
      phase: "failed",
      message: `× 保存失败：${error instanceof Error ? error.message : String(error)}`,
    };
    rerender();
  }
}

function handleCancelActivation(): void {
  if (phase !== "activating") {
    return;
  }
  flowSeq += 1;
  activationOptions = [];
  activationTargets = [];
  phase = "idle";
  rerender();
}

async function runPromptFlow(prompt: string): Promise<void> {
  const text = prompt.trim();
  if (!text) {
    return;
  }
  if (phase === "probing" || phase === "starting" || phase === "running" || phase === "selecting" || phase === "activating") {
    return;
  }
  const flow = ++flowSeq;
  phase = "probing";
  probes = scanningProbes();
  modelOptions = undefined;
  lastResult = null;
  rerender();

  let config: Config;
  try {
    config = await loadAppConfig();
  } catch (error) {
    failTerminal(
      `配置无效：${error instanceof Error ? error.message : String(error)}`,
      flow,
    );
    return;
  }
  if (flow !== flowSeq) {
    return;
  }
  const effectiveMode = resolveRoutingMode(config.routing.mode, userModeOverride);
  currentRoutingMode = effectiveMode;
  const adapters = createCliAdapters({
    agentEnvs: {
      codex: config.agents.codex?.env,
      claude: config.agents.claude?.env,
      pi: config.agents.pi?.env,
      omp: config.agents.omp?.env,
    },
  });
  const catalog = await probeModelCatalog(clis, adapters, config);
  if (flow !== flowSeq) {
    return;
  }

  // 手动 /model 选择优先使用（用后清空），仍必须经过已探测校验。
  const explicit = manualTarget;
  manualTarget = null;
  if (explicit) {
    try {
      const validated = validateExplicitTarget(
        catalog,
        explicit.cliId,
        explicit.modelId ? `${explicit.cliId}:${explicit.modelId}` : undefined,
        config.defaultAgent,
      );
      await startExecution(validated.cliId, validated.modelId, text, catalog, config, flow);
    } catch (error) {
      failTerminal(error instanceof Error ? error.message : String(error), flow);
    }
    return;
  }

  const candidates = toRouteCandidates(catalog, config);
  if (candidates.length === 0) {
    // 全部 CLI 都被取消激活是合法状态：提示用户去哪里重新启用，不自动恢复。
    if (catalog.probes.every((probe) => probe.status === "disabled")) {
      failTerminal("暂无已激活 CLI，输入 /activate 启用后重试", flow);
      return;
    }
    const reasons = catalog.probes
      .map((probe) => `${probe.cliId}: ${probe.reason ?? probe.status}`)
      .join("; ");
    failTerminal(`没有可用的已探测模型（${reasons}）`, flow);
    return;
  }

  // 模式 1：手动选择 (manual) - 每次直接展示选择器供用户自行挑选
  if (effectiveMode === "manual") {
    pendingPrompt = text;
    pendingCatalog = catalog;
    pendingConfig = config;
    phase = "selecting";
    probes = [...catalog.probes];
    modelOptions = [...catalog.options];
    rerender();
    return;
  }

  // 模式 2：Jev 模型决策 (jev) - 调用 TypeSafe Jev 模型决策，不走自动推断
  if (effectiveMode === "jev") {
    try {
      const jevResult = await routeWithJev(
        { prompt: text },
        candidates,
        {
          apiKey: config.routing.typesafeApiKey,
          endpoint: config.routing.typesafeEndpoint,
        },
      );
      if (flow !== flowSeq) {
        return;
      }
      if (!isAgentId(jevResult.agent)) {
        throw new Error(`Jev 选择了不支持的 agent: ${jevResult.agent}`);
      }
      await startExecution(jevResult.agent, jevResult.model, text, catalog, config, flow);
      return;
    } catch (error) {
      if (flow !== flowSeq) {
        return;
      }
      // Jev 决策失败或无 key，绝不走自动推断，转入让用户手动选择
      pendingPrompt = text;
      pendingCatalog = catalog;
      pendingConfig = config;
      phase = "selecting";
      probes = [...catalog.probes];
      modelOptions = [...catalog.options];
      lastResult = {
        phase: "failed",
        message: `Jev 决策未完成 (${error instanceof Error ? error.message : String(error)})，请手动选择目标`,
      };
      rerender();
      return;
    }
  }

  // 模式 3：本地推断 (local)
  let decision: { agent: string; model?: string };
  try {
    decision = route({ prompt: text }, config, { candidates });
  } catch (error) {
    failTerminal(error instanceof Error ? error.message : String(error), flow);
    return;
  }
  if (!isAgentId(decision.agent)) {
    failTerminal(`routing selected unsupported agent: ${decision.agent}`, flow);
    return;
  }

  // 歧义（前两名分数相同）或探测不完整时进入统一选择器，由用户确认。
  if (
    hasAmbiguousRoute({ prompt: text }, config, candidates) ||
    needsSelecting(catalog)
  ) {
    pendingPrompt = text;
    pendingCatalog = catalog;
    pendingConfig = config;
    phase = "selecting";
    probes = [...catalog.probes];
    modelOptions = [...catalog.options];
    rerender();
    return;
  }

  await startExecution(decision.agent, decision.model, text, catalog, config, flow);
}

async function startExecution(
  cliId: CliId,
  modelId: string | undefined,
  prompt: string,
  catalog: ModelCatalog,
  config: Config,
  flow: number,
): Promise<void> {
  const adapters = createCliAdapters();
  const adapter = adapters[cliId];
  let target: LaunchTarget;
  try {
    target = resolveTarget(cliId, config, adapter.bin);
  } catch (error) {
    failTerminal(error instanceof Error ? error.message : String(error), flow);
    return;
  }

  const sessionStore = getStore();
  const startedAt = Date.now();
  let currentSessionId = sessionId;
  if (!currentSessionId) {
    currentSessionId = sessionStore.createSession(cliId, prompt.slice(0, 60), currentWorkspace).id;
    sessionId = currentSessionId;
  }
  const previousTurns = sessionStore.listTurns(currentSessionId);

  const capabilities = adapter.probeCapabilities?.();
  const reusedNative = capabilities?.nativeResume === true && Boolean(nativeSessionIds[cliId]);
  const nativeSessionId = reusedNative ? nativeSessionIds[cliId] : undefined;
  // 原生 resume 优先原文；不支持时走现有 transcript 注入；跨 CLI 切换同样走 transcript。
  const finalPrompt = reusedNative
    ? prompt
    : buildPromptWithContext(previousTurns, prompt);
  const contextSource: TurnContextSource = reusedNative
    ? "native"
    : previousTurns.length > 0
      ? "transcript"
      : "none";

  const agentConfig = config.agents[cliId];
  const args: readonly string[] = adapter.buildPromptArgs
    ? adapter.buildPromptArgs({ prompt: finalPrompt, model: modelId, extraArgs: agentConfig?.extraArgs, nativeSessionId })
    : adapter.promptArgs(finalPrompt);

  const probe = catalog.probes.find((item) => item.cliId === cliId);
  const probedModel = modelId ? probe?.models.find((item) => item.modelId === modelId) : undefined;
  const structured = (probedModel?.capabilities.structuredEvents ?? probe?.models[0]?.capabilities.structuredEvents) === true;
  const protocol = structured ? "structured" : "text";

  initialId = cliId;
  phase = "starting";
  running = { id: cliId, prompt, startedAt, modelId };
  probes = undefined;
  modelOptions = undefined;
  pendingPrompt = null;
  lastResult = null;
  rerender();

  const controller = new AbortController();
  activeAbort = controller;
  phase = "running";
  rerender();

  let liveText = "";
  let statusText = "";
  let tool: string | undefined;
  let observedNativeId: string | undefined;

  const onEvent = (event: AgentEvent): void => {
    if (flow !== flowSeq) {
      return;
    }
    if (event.kind === "assistant_text") {
      liveText += event.text;
    } else if (event.kind === "status") {
      statusText = event.text;
    } else if (event.kind === "tool_started") {
      tool = event.tool;
    } else if (event.kind === "tool_finished") {
      tool = undefined;
    } else if (event.kind === "session_started" && event.nativeSessionId) {
      observedNativeId = event.nativeSessionId;
    } else if (event.kind === "stderr" && !statusText) {
      statusText = event.text.slice(-200);
    }
    running = { id: cliId, prompt, startedAt, modelId, liveText, statusText, tool };
    rerender();
  };

  // 先手补 session_started，保证完成前 UI 即有启动态。
  onEvent({ kind: "session_started", cliId, model: modelId, protocol, nativeSessionId });

  const handle = runAgentStream({
    cmd: buildLaunchCmd(target, args),
    cwd: resolveLaunchCwd(process.cwd(), target),
    target,
    env: { ...process.env, ...agentConfig?.env },
    signal: controller.signal,
    protocol,
    parseChunk: adapter.parseOutputChunk,
    onEvent,
  });

  const result = await handle.done;
  if (flow !== flowSeq) {
    return;
  }
  activeAbort = null;
  running = null;

  const summary = summarizeEvents(result.events);
  if (observedNativeId) {
    nativeSessionIds[cliId] = observedNativeId;
  }

  if (result.status === "completed") {
    phase = "completed";
    const seconds = (result.durationMs / 1000).toFixed(1);
    const contextMark = contextSource === "native" ? " · 原生会话" : contextSource === "transcript" ? " · transcript 上下文" : "";
    lastResult = { phase: "completed", message: `✓ ${cliId}${modelId ? `:${modelId}` : ""} · ${seconds}s${contextMark}` };
    try {
      sessionStore.appendTurn({
        sessionId: currentSessionId,
        cliId,
        prompt,
        output: result.text,
        exitCode: result.code,
        signal: result.signal,
        durationMs: result.durationMs,
        modelId,
        protocol,
        reusedNative,
        status: "completed",
        eventSummary: summary,
        contextSource,
      });
      turns = sessionStore.listTurns(currentSessionId);
    } catch {
      // 存储异常不阻塞界面。
    }
  } else if (result.status === "aborted") {
    phase = "aborted";
    lastResult = { phase: "aborted", message: "已取消当前任务，回到输入态" };
    try {
      sessionStore.appendTurn({
        sessionId: currentSessionId,
        cliId,
        prompt,
        output: result.text,
        exitCode: result.code,
        signal: result.signal,
        durationMs: result.durationMs,
        modelId,
        protocol,
        reusedNative,
        status: "aborted",
        eventSummary: summary,
        contextSource,
      });
      turns = sessionStore.listTurns(currentSessionId);
    } catch {
      // 存储异常不阻塞界面。
    }
  } else if (result.status === "timeout") {
    phase = "failed";
    lastResult = { phase: "failed", message: `× ${cliId} 执行超时，已终止进程组` };
    try {
      sessionStore.appendTurn({
        sessionId: currentSessionId,
        cliId,
        prompt,
        output: result.text,
        exitCode: result.code,
        signal: result.signal,
        durationMs: result.durationMs,
        modelId,
        protocol,
        reusedNative,
        status: "timeout",
        eventSummary: summary,
        contextSource,
      });
      turns = sessionStore.listTurns(currentSessionId);
    } catch {
      // 存储异常不阻塞界面。
    }
  } else {
    phase = "failed";
    const detail = result.stderrTail.trim() || `exit ${result.code ?? "—"}`;
    lastResult = { phase: "failed", message: `× ${cliId}${modelId ? `:${modelId}` : ""} 失败：${detail.slice(0, 300)}` };
    try {
      sessionStore.appendTurn({
        sessionId: currentSessionId,
        cliId,
        prompt,
        output: result.text,
        exitCode: result.code,
        signal: result.signal,
        durationMs: result.durationMs,
        modelId,
        protocol,
        reusedNative,
        status: result.status === "spawn-error" ? "spawn-error" : "failed",
        eventSummary: summary,
        contextSource,
      });
      turns = sessionStore.listTurns(currentSessionId);
    } catch {
      // 存储异常不阻塞界面。
    }
  }
  rerender();
}

async function requestModelSelector(): Promise<void> {
  if (phase === "probing" || phase === "starting" || phase === "running" || phase === "selecting" || phase === "activating") {
    return;
  }
  const flow = ++flowSeq;
  phase = "probing";
  probes = scanningProbes();
  modelOptions = undefined;
  lastResult = null;
  rerender();

  let config: Config;
  try {
    config = await loadAppConfig();
  } catch (error) {
    failTerminal(
      `配置无效：${error instanceof Error ? error.message : String(error)}`,
      flow,
    );
    return;
  }
  if (flow !== flowSeq) {
    return;
  }
  const catalog = await probeModelCatalog(
    clis,
    createCliAdapters({
      agentEnvs: {
        codex: config.agents.codex?.env,
        claude: config.agents.claude?.env,
        pi: config.agents.pi?.env,
        omp: config.agents.omp?.env,
      },
    }),
    config,
  );
  if (flow !== flowSeq) {
    return;
  }
  pendingPrompt = null;
  pendingCatalog = catalog;
  pendingConfig = config;
  phase = "selecting";
  probes = [...catalog.probes];
  modelOptions = [...catalog.options];
  rerender();
}

async function handleSelectModel(option: ModelOption): Promise<void> {
  if (phase !== "selecting" || !option.available) {
    return;
  }
  const catalog = pendingCatalog;
  const config = pendingConfig;
  const targetPrompt = pendingPrompt;
  if (!catalog || !config) {
    return;
  }
  if (!targetPrompt) {
    // 无 prompt 的 /model：只记录手动选择，下次提交优先使用。
    // 选择器已按 CLI 隔离候选，这里再挡一道，避免跨 CLI 的陈旧选择落盘。
    const ownsModel = catalog.options.some(
      (item) =>
        item.cliId === option.cliId && item.modelId === option.modelId,
    );
    if (!ownsModel) {
      return;
    }
    flowSeq += 1;
    manualTarget = { cliId: option.cliId, modelId: option.modelId };
    pendingCatalog = null;
    pendingConfig = null;
    phase = "idle";
    probes = undefined;
    modelOptions = undefined;
    lastResult = { phase: "completed", message: `已选择 ${option.cliId}:${option.modelId}，下次提交将使用它` };
    rerender();
    return;
  }
  try {
    const validated = validateExplicitTarget(
      catalog,
      option.cliId,
      `${option.cliId}:${option.modelId}`,
      config.defaultAgent,
    );
    const flow = flowSeq;
    pendingPrompt = null;
    await startExecution(validated.cliId, validated.modelId, targetPrompt, catalog, config, flow);
  } catch (error) {
    failTerminal(error instanceof Error ? error.message : String(error), flowSeq);
  }
}

function handleCancelSelecting(): void {
  if (phase !== "selecting" && phase !== "probing") {
    return;
  }
  flowSeq += 1;
  activeAbort = null;
  pendingPrompt = null;
  pendingCatalog = null;
  pendingConfig = null;
  probes = undefined;
  modelOptions = undefined;
  running = null;
  phase = "idle";
  rerender();
}

function handleAbort(): void {
  if (phase === "selecting" || phase === "probing") {
    handleCancelSelecting();
    return;
  }
  if (phase === "starting" || phase === "running") {
    activeAbort?.abort();
  }
}

function handleNewSession(): void {
  activeAbort?.abort();
  flowSeq += 1;
  activeAbort = null;
  sessionId = null;
  turns = [];
  nativeSessionIds = {};
  manualTarget = null;
  pendingPrompt = null;
  pendingCatalog = null;
  pendingConfig = null;
  probes = undefined;
  modelOptions = undefined;
  activationOptions = [];
  activationTargets = [];
  running = null;
  lastResult = null;
  phase = "idle";
  rerender();
}

async function launch(request: LaunchRequest): Promise<void> {
  if (phase === "probing" || phase === "starting" || phase === "running" || phase === "selecting" || phase === "activating") {
    return;
  }
  if (running) {
    return;
  }
  const detected = clis.find(
    (cli) => cli.id === request.id && cli.available,
  );
  const target = detected ? cliLaunchTarget(detected) : null;
  const adapter = getCliAdapter(request.id);
  initialId = request.id;

  if (request.mode === "interactive") {
    if (!target) {
      return;
    }

    // 交互模式必须继承 stdio：Ink 先卸载，把终端完整交给 agent 的
    // REPL，退出后重挂载。交互输出无法捕获，不写入会话层。
    app?.unmount();
    try {
      const child = launchInteractive(adapter, {
        target,
        cwd: resolveLaunchCwd(process.cwd(), target),
      });
      await waitForChildExit(child);
    } catch {
      // 启动失败不打断流程，回到界面由用户重试。
    }
    mount();
    return;
  }

  await runPromptFlow(request.prompt);
}

try {
  const currentStore = getStore();
  const favorite = currentStore.getFavoriteAgent();
  if (favorite) {
    initialId = favorite;
  }
} catch {
  // SQLite 读取异常不阻断启动
}

mount();

void scanCodingClis()
  .then(async (detected) => {
    clis = detected;
    isScanning = false;
    // 只有「已安装且用户还没决策过」的 CLI 才需要问一次；否则直接进模式页。
    try {
      const config = await loadAppConfig();
      userModeOverride = null;
      currentRoutingMode = resolveRoutingMode(config.routing.mode, userModeOverride);
      enterActivationConfirm(detected, config);
    } catch (error) {
      phase = "failed";
      lastResult = {
        phase: "failed",
        message: `配置无效：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    rerender();
  })
  .catch((error) => {
    clis = [];
    isScanning = false;
    phase = "failed";
    lastResult = {
      phase: "failed",
      message: `扫描失败：${error instanceof Error ? error.message : String(error)}`,
    };
    rerender();
  });
