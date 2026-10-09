import { createCliAdapters, type CliAdapterOptions } from "../agents/cli-adapters";
import {
  probeModelCatalog,
  toRouteCandidates,
  validateExplicitTarget,
} from "../agents/model-catalog";
import { isAgentId } from "../agents/registry";
import { loadConfig } from "../config/loader";
import type { Config, RoutingMode } from "../config/schema";
import { CLI_IDS, cliLaunchTarget, type CliId, type DetectedCli, type LaunchTarget } from "../models/cli";
import type { AgentEvent } from "../models/agent-events";
import type { ModelStrength } from "../models/types";
import { jevDecisionToRouteDecision, routeWithJev } from "../router/jev";
import { resolveRoutingMode, route } from "../router/router";
import type { RouteDecision } from "../router/types";
import { runAgentStream, type AgentRunHandle } from "../runtime/agent-run";
import { buildLaunchCmd, resolveLaunchCwd } from "../runtime/launcher";
import { resolveCommand, type ProcessOptions, type ProcessResult } from "../runtime/process";
import { scanCodingClis, type ScannerOptions } from "../scanner/cli-scanner";

export interface RunCommandOptions {
  readonly prompt: string;
  readonly cwd?: string;
  readonly configPath?: string;
  readonly config?: Config;
  readonly mode?: RoutingMode;
  /** Explicit agent selection; skips routing when set. */
  readonly agent?: string;
  /** Explicit model or `agent:model` reference; skips routing when set. */
  readonly model?: string;
  readonly files?: readonly string[];
  readonly language?: string;
  readonly contextSize?: number;
  readonly requiredStrengths?: readonly ModelStrength[];
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly env?: Record<string, string | undefined>;
  readonly scanner?: ScannerOptions;
}

export interface RunCommandDependencies {
  readonly scan?: (options?: ScannerOptions) => Promise<DetectedCli[]>;
  /** 遗留注入点：统一生命周期落地后不再使用，保留兼容外部调用。 */
  readonly run?: (options: ProcessOptions) => Promise<ProcessResult>;
  readonly stream?: (
    options: Parameters<typeof runAgentStream>[0],
  ) => AgentRunHandle;
  readonly resolve?: (command: string) => string | null;
  readonly adapters?: CliAdapterOptions;
  /** Diagnostic output, including routing and process errors. Defaults to stderr. */
  readonly write?: (text: string) => void;
  /** Agent stdout（assistant 文本）。默认写 stdout。 */
  readonly writeOut?: (text: string) => void;
}

function findDetected(
  detected: readonly DetectedCli[],
  id: CliId,
): DetectedCli | undefined {
  return detected.find((item) => item.id === id);
}

function availableAgents(
  config: Config,
  detected: readonly DetectedCli[],
  resolve: (command: string) => string | null,
): CliId[] {
  return CLI_IDS.filter((id) => {
    if (config.agents[id]?.enabled === false) {
      return false;
    }

    const detectedCli = findDetected(detected, id);
    if (detectedCli?.available && detectedCli.path) {
      return true;
    }

    const configuredCommand = config.agents[id]?.command?.trim();
    return Boolean(configuredCommand && resolve(configuredCommand));
  });
}

function resolveTarget(
  agent: CliId,
  config: Config,
  detected: readonly DetectedCli[],
  bin: string,
  resolve: (command: string) => string | null,
): LaunchTarget {
  const configuredCommand = config.agents[agent]?.command?.trim();
  if (configuredCommand) {
    const resolved = resolve(configuredCommand);
    if (!resolved) {
      throw new Error(
        `configured command for ${agent} was not found: ${configuredCommand}`,
      );
    }
    return { path: resolved, runtime: "local" };
  }

  // 扫描结果携带真实运行上下文（本地 / WSL），启动必须沿用同一条路径，
  // 不在启动时重新按 bin 名称查找，避免 PATH 变化导致启动失败。
  const detectedCli = findDetected(detected, agent);
  const scanned = detectedCli ? cliLaunchTarget(detectedCli) : null;
  if (scanned) {
    return scanned;
  }

  const resolved = resolve(bin);
  if (resolved) {
    return { path: resolved, runtime: "local" };
  }

  throw new Error(`agent is not available: ${agent}`);
}

function targetDescription(agent: CliId, model?: string): string {
  return model ? `${agent}:${model}` : agent;
}

/**
 * Resolve a prompt to an agent and stream the selected CLI in the current
 * terminal. Explicit agent/model options bypass routing but still require the
 * selected agent to be enabled and installed.
 */
export async function runRunCommand(
  options: RunCommandOptions,
  dependencies: RunCommandDependencies = {},
): Promise<number> {
  const write =
    dependencies.write ?? ((text: string) => process.stderr.write(text));
  const writeOut =
    dependencies.writeOut ?? ((text: string) => process.stdout.write(text));
  const scan = dependencies.scan ?? scanCodingClis;
  const resolve = dependencies.resolve ?? resolveCommand;
  const startStream = dependencies.stream ?? runAgentStream;

  try {
    if (!options.prompt.trim()) {
      throw new Error("prompt must not be empty");
    }

    const loaded =
      options.config === undefined
        ? await loadConfig({ cwd: options.cwd, path: options.configPath })
        : { config: options.config };
    const config = loaded.config;
    const detected = await scan(options.scanner);
    const cliAdapters = createCliAdapters({
      ...dependencies.adapters,
      agentEnvs: {
        ...dependencies.adapters?.agentEnvs,
        codex: { ...dependencies.adapters?.agentEnvs?.codex, ...config.agents.codex?.env },
        claude: { ...dependencies.adapters?.agentEnvs?.claude, ...config.agents.claude?.env },
        pi: { ...dependencies.adapters?.agentEnvs?.pi, ...config.agents.pi?.env },
        omp: { ...dependencies.adapters?.agentEnvs?.omp, ...config.agents.omp?.env },
      },
    });

    // 统一探测：以 CLI 原生配置为事实来源，失败带原因且禁止执行。
    const catalog = await probeModelCatalog(detected, cliAdapters, config);

    let agent: CliId;
    let model: string | undefined;
    let decision: RouteDecision | undefined;
    const routingMode = resolveRoutingMode(config.routing.mode, options.mode);

    if (options.agent || options.model) {
      const explicit = validateExplicitTarget(
        catalog,
        options.agent,
        options.model,
        config.defaultAgent,
      );
      agent = explicit.cliId;
      model = explicit.modelId;
    } else if (routingMode === "manual") {
      throw new Error(
        "routing.mode=manual 时，非交互 run 必须显式提供 --agent 或 --model",
      );
    } else if (routingMode === "jev") {
      const candidates = toRouteCandidates(catalog, config);
      if (candidates.length === 0) {
        const reasons = catalog.probes
          .map((probe) => `${probe.cliId}: ${probe.reason ?? probe.status}`)
          .join("; ");
        throw new Error(`没有可用的已探测模型（${reasons}）`);
      }
      const jevResult = await routeWithJev(
        {
          prompt: options.prompt,
          files: options.files,
          language: options.language,
          contextSize: options.contextSize,
          requiredStrengths: options.requiredStrengths,
        },
        candidates,
        {
          apiKey: config.routing.typesafeApiKey,
          endpoint: config.routing.typesafeEndpoint,
          cwd: options.cwd,
        },
      );
      if (!isAgentId(jevResult.agent)) {
        throw new Error(`Jev routing selected unsupported agent: ${jevResult.agent}`);
      }
      agent = jevResult.agent;
      model = jevResult.model;
      decision = jevDecisionToRouteDecision(jevResult);
    } else {
      const candidates = toRouteCandidates(catalog, config);
      if (candidates.length === 0) {
        const reasons = catalog.probes
          .map((probe) => `${probe.cliId}: ${probe.reason ?? probe.status}`)
          .join("; ");
        throw new Error(`没有可用的已探测模型（${reasons}）`);
      }
      const routed = route(
        {
          prompt: options.prompt,
          files: options.files,
          language: options.language,
          contextSize: options.contextSize,
          requiredStrengths: options.requiredStrengths,
        },
        config,
        { candidates },
      );
      if (!isAgentId(routed.agent)) {
        throw new Error(`routing selected unsupported agent: ${routed.agent}`);
      }
      agent = routed.agent;
      model = routed.model;
      decision = routed;
    }
    void decision;

    const adapter = cliAdapters[agent];
    const probe = catalog.probes.find((item) => item.cliId === agent);
    const probed = probe?.models.find((item) => item.modelId === (model ?? item.modelId));
    const structured = probed?.capabilities.structuredEvents === true;
    const executable = resolveTarget(agent, config, detected, adapter.bin, resolve);
    const agentConfig = config.agents[agent];
    const args = adapter.buildPromptArgs
      ? [...adapter.buildPromptArgs({ prompt: options.prompt, model, extraArgs: agentConfig?.extraArgs })]
      : [...adapter.promptArgs(options.prompt)];
    void CLI_IDS;

    write(`coderelay: routing to ${targetDescription(agent, model)}\n`);

    const launchCwd = resolveLaunchCwd(options.cwd, executable);
    if (executable.runtime === "wsl" && options.cwd && !launchCwd) {
      write(
        `coderelay: 无法把工作目录转换为 WSL 路径（${options.cwd}），将在 WSL 当前目录执行\n`,
      );
    }

    // 统一流式生命周期：assistant 文本写 stdout，诊断写 stderr。
    const onEvent = (event: AgentEvent): void => {
      if (event.kind === "assistant_text") {
        writeOut(event.text);
      } else if (event.kind === "stderr") {
        write(event.text);
      } else if (event.kind === "tool_started") {
        write(`coderelay: 正在执行工具：${event.tool}\n`);
      } else if (event.kind === "status") {
        write(`coderelay: ${event.text}\n`);
      }
    };
    const handle = startStream({
      cmd: buildLaunchCmd(executable, args),
      cwd: launchCwd,
      target: executable,
      env: { ...process.env, ...agentConfig?.env, ...options.env },
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      protocol: structured ? "structured" : "text",
      parseChunk: adapter.parseOutputChunk,
      onEvent,
    });
    const result = await handle.done;

    if (result.status === "completed") {
      return 0;
    }
    if (result.status === "timeout") {
      write(`coderelay run: process timed out after ${options.timeoutMs ?? 0}ms\n`);
      return 124;
    }
    if (result.status === "aborted") {
      write("coderelay run: process aborted\n");
      return 130;
    }
    if (result.stderrTail.trim()) {
      write(result.stderrTail.endsWith("\n") ? result.stderrTail : `${result.stderrTail}\n`);
    }
    return result.code !== null && result.code > 0 ? result.code : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(`coderelay run: ${message}\n`);
    return 1;
  }
}
