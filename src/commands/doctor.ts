import { homedir } from "node:os";
import path from "node:path";

import { isAgentId } from "../agents/registry";
import { loadConfig } from "../config/loader";
import type { Config } from "../config/schema";
import {
  CLI_IDS,
  cliCandidates,
  cliDiagnostics,
  cliLaunchTarget,
  cliRuntime,
  cliSource,
  type CliCandidate,
  type CliId,
  type DetectedCli,
} from "../models/cli";
import {
  installHintLines,
  installPlatformFor,
  type InstallPlatform,
} from "../models/install-guide";
import { parseModelRef } from "../models/types";
import { resolveCommand } from "../runtime/process";
import {
  isDirOnPath,
  standardInstallDirs,
  userInstallDirs,
} from "../scanner/candidate-paths";
import { scanCodingClis, type ScannerOptions } from "../scanner/cli-scanner";

export type DoctorStatus = "ok" | "warn" | "error";

export interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorStatus;
  readonly message: string;
  /** Extra indented lines: remediation, install commands, candidate lists. */
  readonly details?: readonly string[];
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly ok: boolean;
}

export interface DoctorCommandOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly config?: Config;
  readonly scanner?: ScannerOptions;
}

export interface DoctorCommandDependencies {
  readonly scan?: (options?: ScannerOptions) => Promise<DetectedCli[]>;
  readonly resolve?: (command: string) => string | null;
  readonly write?: (text: string) => void;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}

export interface BuildDoctorReportOptions {
  readonly configPath?: string | null;
  readonly resolve?: (command: string) => string | null;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}

interface AgentAvailability {
  readonly available: boolean;
  readonly path: string | null;
  readonly version: string | null;
  /** `config.agents[id].command` overrides detection entirely. */
  readonly fromConfig: boolean;
}

interface DoctorEnvironment {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly homeDir: string;
  readonly installPlatform: InstallPlatform;
}

function hasModel(agent: Config["agents"][string], model: string): boolean {
  return agent.models.some((entry) => entry.id === model);
}

function modelCouldTargetAgent(
  config: Config,
  agentId: CliId,
  model: string,
): boolean {
  const agent = config.agents[agentId];
  if (!agent) {
    return true;
  }

  return agent.models.length === 0 || hasModel(agent, model);
}

function enabledAgentIds(config: Config): CliId[] {
  return CLI_IDS.filter((id) => config.agents[id]?.enabled !== false);
}

function availabilityFor(
  id: CliId,
  config: Config,
  detected: readonly DetectedCli[],
  resolve: (command: string) => string | null,
): AgentAvailability {
  const detectedCli = detected.find((item) => item.id === id);
  const configuredCommand = config.agents[id]?.command?.trim();

  if (configuredCommand) {
    const resolved = resolve(configuredCommand);
    return {
      available: resolved !== null,
      path: resolved ?? configuredCommand,
      version: detectedCli?.path === resolved ? detectedCli.version : null,
      fromConfig: true,
    };
  }

  if (detectedCli?.available) {
    return {
      available: true,
      path: detectedCli.path,
      version: detectedCli.version,
      fromConfig: false,
    };
  }

  return { available: false, path: null, version: null, fromConfig: false };
}

function platformLabel(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return "macOS";
  }
  if (platform === "win32") {
    return "Windows";
  }
  if (platform === "linux") {
    return "Linux";
  }
  return platform;
}

function shellLabel(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string {
  if (platform === "win32") {
    return env.PSModulePath ? "PowerShell" : "cmd";
  }
  const shell = env.SHELL?.trim();
  if (!shell) {
    return "sh";
  }
  const parts = shell.split(/[\\/]/);
  return parts[parts.length - 1] || shell;
}

function envDirName(value: string, platform: NodeJS.Platform): string {
  const split = platform === "win32" ? path.win32 : path.posix;
  return split.dirname(value);
}

function candidateLabel(candidate: CliCandidate): string {
  return `${candidate.path} (${candidate.source})`;
}

function environmentCheck(environment: DoctorEnvironment): DoctorCheck {
  const origin = environment.platform === "win32" ? "原生 Windows" : "本机 shell";
  return {
    name: "environment",
    status: "ok",
    message: `${platformLabel(environment.platform)} · ${shellLabel(
      environment.platform,
      environment.env,
    )} · ${origin}`,
  };
}

function pathCheck(environment: DoctorEnvironment): DoctorCheck {
  const dirs = [
    ...userInstallDirs(
      environment.platform,
      environment.homeDir,
      environment.env,
    ),
    ...standardInstallDirs(environment.platform, environment.homeDir),
  ];
  const unique: string[] = [];
  for (const entry of dirs) {
    if (!unique.includes(entry.dir)) {
      unique.push(entry.dir);
    }
  }

  const onPath = unique.filter((dir) =>
    isDirOnPath(dir, environment.platform, environment.env),
  );
  if (onPath.length > 0) {
    return {
      name: "PATH",
      status: "ok",
      message: `包含常见安装目录：${onPath.join(", ")}`,
    };
  }

  return {
    name: "PATH",
    status: "warn",
    message: "未包含任何常见 CLI 安装目录",
    details: [
      "已检查的目录：",
      ...unique.map((dir) => `  ${dir}`),
      "安装后终端仍找不到命令时，把其中一个目录加入 PATH 并重新打开终端。",
    ],
  };
}

/**
 * One CLI check, distinguishing the states a user has to act on differently:
 * missing, installed but invisible to this shell, and discoverable but
 * un-probeable.
 */
function cliCheck(
  id: CliId,
  availability: AgentAvailability,
  required: boolean,
  detectedCli: DetectedCli | undefined,
  environment: DoctorEnvironment,
): DoctorCheck {
  const name = `cli ${id}`;
  const candidates = detectedCli ? cliCandidates(detectedCli) : [];
  const diagnostics = detectedCli
    ? cliDiagnostics(detectedCli).map((diagnostic) => diagnostic.message)
    : [];
  const hints = installHintLines(id, environment.installPlatform);

  if (!availability.available) {
    // An explicit `agents.<id>.command` is authoritative: if it did not
    // resolve, the config points at something that is not there.
    if (availability.fromConfig) {
      return {
        name,
        status: "error",
        message: `配置的 command 不存在：${availability.path ?? ""}`,
        details: [
          "修正 config 中的 agents." + id + ".command，或删除它改用自动探测。",
        ],
      };
    }

    const status: DoctorStatus = required ? "error" : "warn";
    if (candidates.length > 0) {
      return {
        name,
        status,
        message: `发现 ${candidates.length} 个候选，但都不可启动`,
        details: [
          ...candidates.map((candidate) => `  ${candidateLabel(candidate)}`),
          ...diagnostics,
          "安装方式（复制到终端执行，coderelay 不会代跑）：",
          ...hints.map((line) => `  ${line}`),
        ],
      };
    }

    return {
      name,
      status,
      message: required
        ? "未安装（当前配置需要它）"
        : "未安装（可选）",
      details: [
        ...diagnostics,
        "安装方式（复制到终端执行，coderelay 不会代跑）：",
        ...hints.map((line) => `  ${line}`),
      ],
    };
  }

  if (availability.fromConfig) {
    return {
      name,
      status: "ok",
      message: `config 指定 · ${availability.path ?? ""}`,
    };
  }

  const where = availability.path ?? "";
  const source = detectedCli ? cliSource(detectedCli) : "path";

  if (availability.version === null) {
    return {
      name,
      status: "warn",
      message: `可发现但版本探测失败 · ${where}`,
      details: [
        "该 CLI 可能未完整安装，或 --version 需要交互；请先在终端手动确认。",
        ...diagnostics,
      ],
    };
  }

  const dir = where ? envDirName(where, environment.platform) : "";
  if (dir && !isDirOnPath(dir, environment.platform, environment.env)) {
    return {
      name,
      status: "warn",
      message: `已安装但不在当前 PATH · ${availability.version} · ${where}`,
      details: [
        `把 ${dir} 加入 PATH 并重新打开终端，就能在终端直接调用 ${id}。`,
        ...diagnostics,
      ],
    };
  }

  return {
    name,
    status: "ok",
    message: `${availability.version} · ${where} · ${source}`,
    ...(diagnostics.length > 0 ? { details: diagnostics } : {}),
  };
}

function validateRules(
  config: Config,
  checks: DoctorCheck[],
): void {
  config.routing.rules.forEach((rule, index) => {
    const label = `rule ${index + 1} (${rule.name})`;
    const requestedAgent = rule.use.agent;

    if (
      requestedAgent &&
      (!isAgentId(requestedAgent) ||
        config.agents[requestedAgent]?.enabled === false)
    ) {
      checks.push({
        name: label,
        status: "error",
        message: requestedAgent
          ? `unknown or disabled agent: ${requestedAgent}`
          : "rule has no target",
      });
      return;
    }

    if (!rule.use.model) {
      if (!requestedAgent) {
        checks.push({
          name: label,
          status: "warn",
          message: "catch-all rule has no agent or model target",
        });
      } else {
        checks.push({
          name: label,
          status: "ok",
          message: `targets ${requestedAgent}`,
        });
      }
      return;
    }

    if (requestedAgent) {
      if (
        !isAgentId(requestedAgent) ||
        !modelCouldTargetAgent(config, requestedAgent, rule.use.model)
      ) {
        checks.push({
          name: label,
          status: "error",
          message: `model is not configured for ${requestedAgent}: ${rule.use.model}`,
        });
        return;
      }

      checks.push({
        name: label,
        status: "ok",
        message: `targets ${requestedAgent}:${rule.use.model}`,
      });
      return;
    }

    const possible = enabledAgentIds(config).filter((id) =>
      modelCouldTargetAgent(config, id, rule.use.model ?? ""),
    );
    if (possible.length === 0) {
      checks.push({
        name: label,
        status: "error",
        message: `model is not configured for any enabled agent: ${rule.use.model}`,
      });
      return;
    }

    checks.push({
      name: label,
      status: "ok",
      message: `targets ${rule.use.model}`,
    });
  });
}

export function buildDoctorReport(
  config: Config,
  detected: readonly DetectedCli[],
  options: BuildDoctorReportOptions = {},
): DoctorReport {
  const resolve = options.resolve ?? resolveCommand;
  const checks: DoctorCheck[] = [];
  const environment: DoctorEnvironment = {
    platform: options.platform ?? process.platform,
    env: options.env ?? process.env,
    homeDir: options.homeDir ?? homedir(),
    installPlatform: installPlatformFor(options.platform ?? process.platform),
  };

  checks.push(
    options.configPath
      ? {
          name: "config",
          status: "ok",
          message: `loaded ${options.configPath}`,
        }
      : {
          name: "config",
          status: "warn",
          message: "no config file found; using built-in defaults",
        },
  );

  checks.push(environmentCheck(environment));
  checks.push(pathCheck(environment));

  const defaultAgent = config.defaultAgent;
  if (!isAgentId(defaultAgent)) {
    checks.push({
      name: "default agent",
      status: "error",
      message: `unsupported agent: ${defaultAgent}`,
    });
  } else if (config.agents[defaultAgent]?.enabled === false) {
    checks.push({
      name: "default agent",
      status: "error",
      message: `${defaultAgent} is disabled`,
    });
  } else {
    checks.push({
      name: "default agent",
      status: "ok",
      message: defaultAgent,
    });
  }

  for (const id of Object.keys(config.agents)) {
    if (!isAgentId(id)) {
      checks.push({
        name: `agent ${id}`,
        status: "error",
        message: "unsupported agent id",
      });
    }
  }

  const requiredAgents = new Set<string>([defaultAgent]);
  for (const [id, agent] of Object.entries(config.agents)) {
    if (agent.enabled) {
      requiredAgents.add(id);
    }

    const duplicateModels = agent.models
      .map((model) => model.id)
      .filter((model, index, models) => models.indexOf(model) !== index);
    if (duplicateModels.length > 0) {
      checks.push({
        name: `agent ${id}`,
        status: "error",
        message: `duplicate model ids: ${[...new Set(duplicateModels)].join(", ")}`,
      });
    }
  }

  for (const id of CLI_IDS) {
    const availability = availabilityFor(id, config, detected, resolve);
    const required = requiredAgents.has(id);

    checks.push(
      cliCheck(
        id,
        availability,
        required,
        detected.find((item) => item.id === id),
        environment,
      ),
    );
  }

  if (config.defaultModel) {
    const reference = parseModelRef(config.defaultModel, config.defaultAgent);
    if (!reference.model) {
      checks.push({
        name: "default model",
        status: "error",
        message: "model id must not be empty",
      });
    } else if (
      reference.agent &&
      reference.agent !== config.defaultAgent
    ) {
      checks.push({
        name: "default model",
        status: "error",
        message: `must target defaultAgent ${config.defaultAgent}`,
      });
    } else if (
      reference.agent &&
      isAgentId(reference.agent) &&
      !modelCouldTargetAgent(config, reference.agent, reference.model)
    ) {
      checks.push({
        name: "default model",
        status: "error",
        message: `model is not configured for ${reference.agent}: ${reference.model}`,
      });
    } else {
      checks.push({
        name: "default model",
        status: "ok",
        message: `${reference.agent ?? config.defaultAgent}:${reference.model}`,
      });
    }
  }

  validateRules(config, checks);

  return {
    checks,
    ok: checks.every((check) => check.status !== "error"),
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  return report.checks
    .flatMap((check) => [
      `${check.status.padEnd(5)} ${check.name}: ${check.message}`,
      ...(check.details ?? []).map((line) => `      ${line}`),
    ])
    .join("\n");
}

export async function runDoctorCommand(
  options: DoctorCommandOptions = {},
  dependencies: DoctorCommandDependencies = {},
): Promise<number> {
  const write = dependencies.write ?? ((text: string) => process.stdout.write(text));
  const scan = dependencies.scan ?? scanCodingClis;

  try {
    const loaded =
      options.config === undefined
        ? await loadConfig({
            cwd: options.cwd,
            path: options.configPath,
            homeDir: dependencies.homeDir,
            env: dependencies.env,
            platform: dependencies.platform,
          })
        : { config: options.config, path: options.configPath ?? null };
    const detected = await scan(options.scanner);
    const report = buildDoctorReport(loaded.config, detected, {
      configPath: loaded.path,
      resolve: dependencies.resolve,
      platform: dependencies.platform,
      env: dependencies.env,
      homeDir: dependencies.homeDir,
    });
    write(`${formatDoctorReport(report)}\n`);
    return report.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(`coderelay doctor: ${message}\n`);
    return 1;
  }
}
