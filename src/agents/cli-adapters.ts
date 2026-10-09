import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import {
  CLI_IDS,
  DEFAULT_VERSION_ARGS,
  type CliAdapter,
  type CliId,
  type PromptBuildOptions,
} from "../models/cli";
import {
  parseStructuredLine,
  type AgentEvent,
} from "../models/agent-events";
import {
  validateProbedModels,
  type CliCapabilities,
  type ProbeResult,
  type ProbedModel,
} from "./capabilities";

export interface CliAdapterOptions {
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Per-CLI environment overrides used while resolving native config paths. */
  readonly agentEnvs?: Partial<Record<CliId, NodeJS.ProcessEnv>>;
}

function configuredPath(homeDir: string, value: string | undefined, fallback: string): string {
  const configured = value?.trim();
  if (!configured) return fallback;
  return path.isAbsolute(configured) ? configured : path.join(homeDir, configured);
}

function codexConfigDir(homeDir: string, env: NodeJS.ProcessEnv): string {
  return configuredPath(homeDir, env.CODEX_HOME, path.join(homeDir, ".codex"));
}

function claudeConfigDir(homeDir: string, env: NodeJS.ProcessEnv): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  return configured || path.join(homeDir, ".claude");
}

function piConfigDir(homeDir: string, env: NodeJS.ProcessEnv): string {
  return configuredPath(homeDir, env.PI_CODING_AGENT_DIR, path.join(homeDir, ".pi", "agent"));
}

function ompConfigDirs(
  homeDir: string,
  env: NodeJS.ProcessEnv,
): { readonly rootDir: string; readonly agentDir: string } {
  const rootDir = configuredPath(homeDir, env.PI_CONFIG_DIR, path.join(homeDir, ".omp"));
  const agentDir = configuredPath(homeDir, env.PI_CODING_AGENT_DIR, path.join(rootDir, "agent"));
  return { rootDir, agentDir };
}

async function readJsonFile(file: string): Promise<unknown> {
  const text = await readFile(file, "utf8");
  return JSON.parse(text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function modelFromToml(text: string): string | undefined {
  const match = text.match(/^\s*model\s*=\s*"([^"]+)"/m);
  return match?.[1];
}

function modelCatalogFromToml(text: string): string | undefined {
  const match = text.match(/^\s*model_catalog_json\s*=\s*"([^"]+)"/m);
  return match?.[1];
}

function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(reason)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function probeCodexModels(configDir: string): Promise<ProbeResult> {
  try {
    const run = async (): Promise<ProbeResult> => {
      const configFile = path.join(configDir, "config.toml");
      let defaultId: string | undefined;
      let configuredCatalog: string | undefined;
      try {
        const toml = await readFile(configFile, "utf8");
        defaultId = modelFromToml(toml);
        configuredCatalog = modelCatalogFromToml(toml);
      } catch {
        defaultId = undefined;
        configuredCatalog = undefined;
      }

      const candidateFiles: string[] = [];
      if (configuredCatalog) {
        candidateFiles.push(
          path.isAbsolute(configuredCatalog)
            ? configuredCatalog
            : path.join(configDir, configuredCatalog),
        );
      }
      candidateFiles.push(path.join(configDir, "models_cache.json"));
      candidateFiles.push(path.join(configDir, "cc-switch-model-catalog.json"));

      let catalogRaw: unknown;
      let usedCatalogFile: string | undefined;
      for (const file of candidateFiles) {
        try {
          catalogRaw = await readJsonFile(file);
          usedCatalogFile = file;
          break;
        } catch {
          // File does not exist or unreadable, try next candidate.
        }
      }

      if (!usedCatalogFile || catalogRaw === undefined) {
        if (defaultId) {
          return {
            ok: true,
            models: [{ id: defaultId, isDefault: true }],
            capabilities: {
              structuredEvents: false,
              nativeResume: true,
              nonInteractivePrompt: true,
              explicitModel: true,
              toolEvents: false,
            },
          };
        }
        return {
          ok: false,
          reason: `codex 模型配置缺失：未找到 models_cache.json`,
        };
      }

      if (!isRecord(catalogRaw) || !Array.isArray(catalogRaw["models"])) {
        return { ok: false, reason: `codex 模型目录格式非法：${usedCatalogFile}` };
      }

      const rawModels: unknown[] = [];
      for (const entry of catalogRaw["models"] as unknown[]) {
        if (!isRecord(entry)) continue;
        const slug = entry["slug"];
        if (typeof slug !== "string" || !slug) continue;
        rawModels.push({
          id: slug,
          label: typeof entry["display_name"] === "string" ? (entry["display_name"] as string) : undefined,
          description: typeof entry["description"] === "string" ? (entry["description"] as string) : undefined,
        });
      }

      const models = validateProbedModels(rawModels);
      if (!models || models.length === 0) {
        if (defaultId) {
          return {
            ok: true,
            models: [{ id: defaultId, isDefault: true }],
            capabilities: {
              structuredEvents: false,
              nativeResume: true,
              nonInteractivePrompt: true,
              explicitModel: true,
              toolEvents: false,
            },
          };
        }
        return { ok: false, reason: `codex 模型目录为空：${usedCatalogFile}` };
      }

      const marked: ProbedModel[] = models.map((model) => ({
        ...model,
        isDefault: defaultId ? model.id === defaultId : undefined,
      }));

      if (defaultId && !marked.some((m) => m.id === defaultId)) {
        marked.unshift({ id: defaultId, isDefault: true });
      }

      return {
        ok: true,
        models: marked,
        capabilities: {
          structuredEvents: false,
          nativeResume: true,
          nonInteractivePrompt: true,
          explicitModel: true,
          toolEvents: false,
        },
      };
    };
    return await withTimeout(run(), 5000, "codex 模型探测超时");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `codex 探测失败：${message}` };
  }
}

async function probeClaudeModels(configDir: string): Promise<ProbeResult> {
  try {
    const run = async (): Promise<ProbeResult> => {
      const settingsFile = path.join(configDir, "settings.json");
      let raw: unknown;
      try {
        raw = await readJsonFile(settingsFile);
      } catch {
        return { ok: false, reason: `claude 配置缺失：${settingsFile}` };
      }
      if (!isRecord(raw)) {
        return { ok: false, reason: `claude 配置格式非法：${settingsFile}` };
      }
      const env = isRecord(raw["env"]) ? (raw["env"] as Record<string, unknown>) : {};
      const ids = new Set<string>();
      const push = (value: unknown) => {
        if (typeof value === "string" && value.trim()) ids.add(value.trim());
      };
      push(env["ANTHROPIC_DEFAULT_OPUS_MODEL"]);
      push(env["ANTHROPIC_DEFAULT_SONNET_MODEL"]);
      push(env["ANTHROPIC_DEFAULT_HAIKU_MODEL"]);
      push(env["ANTHROPIC_DEFAULT_FABLE_MODEL"]);
      push(env["CLAUDE_CODE_SUBAGENT_MODEL"]);
      const configured = typeof raw["model"] === "string" ? (raw["model"] as string).trim() : "";
      // settings.json 的 model 可能是 opus/sonnet 等别名，同样视为候选。
      if (configured) ids.add(configured);
      if (ids.size === 0) {
        return { ok: false, reason: `claude 未配置任何模型：${settingsFile}` };
      }
      const models: ProbedModel[] = [...ids].map((id) => ({
        id,
        isDefault: configured ? id === configured : undefined,
      }));
      return {
        ok: true,
        models,
        capabilities: {
          structuredEvents: false,
          nativeResume: true,
          nonInteractivePrompt: true,
          explicitModel: true,
          toolEvents: false,
        },
      };
    };
    return await withTimeout(run(), 5000, "claude 模型探测超时");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `claude 探测失败：${message}` };
  }
}

async function probePiModels(configDir: string): Promise<ProbeResult> {
  try {
    const run = async (): Promise<ProbeResult> => {
      const modelsFile = path.join(configDir, "models.json");
      let raw: unknown;
      try {
        raw = await readJsonFile(modelsFile);
      } catch (error) {
        // models.json only defines custom providers. Pi ships built-in models and
        // can use its native default without passing --model at all.
        if (isRecord(error) && error["code"] === "ENOENT") {
          return {
            ok: true,
            models: [{ id: "", label: "Pi 默认模型", isDefault: true }],
            capabilities: {
              structuredEvents: false,
              nativeResume: true,
              nonInteractivePrompt: true,
              explicitModel: true,
              toolEvents: false,
            },
          };
        }
        return { ok: false, reason: `pi 模型配置读取失败：${modelsFile}` };
      }
      if (!isRecord(raw) || !isRecord(raw["providers"])) {
        return { ok: false, reason: `pi 模型配置格式非法：${modelsFile}` };
      }
      const providers = raw["providers"] as Record<string, unknown>;
      const models: ProbedModel[] = [];
      for (const [providerKey, provider] of Object.entries(providers)) {
        const trimmedKey = providerKey.trim();
        if (!trimmedKey || !isRecord(provider) || !Array.isArray(provider["models"])) continue;
        for (const entry of provider["models"] as unknown[]) {
          if (!isRecord(entry)) continue;
          const rawId = typeof entry["id"] === "string" ? entry["id"].trim() : "";
          if (!rawId) continue;
          const id = rawId.startsWith(`${trimmedKey}/`) ? rawId : `${trimmedKey}/${rawId}`;
          models.push({
            id,
            label: typeof entry["name"] === "string" ? (entry["name"] as string) : undefined,
          });
        }
      }
      if (models.length === 0) {
        return { ok: false, reason: `pi 模型列表为空：${modelsFile}` };
      }
      return {
        ok: true,
        models,
        capabilities: {
          structuredEvents: false,
          nativeResume: true,
          nonInteractivePrompt: true,
          explicitModel: true,
          toolEvents: false,
        },
      };
    };
    return await withTimeout(run(), 5000, "pi 模型探测超时");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `pi 探测失败：${message}` };
  }
}

function isOmpModelId(value: string): boolean {
  const trimmed = value.trim();
  const separator = trimmed.indexOf("/");
  return separator > 0 && separator < trimmed.length - 1 && !/[\s]/.test(trimmed);
}

function addOmpModel(
  models: Map<string, ProbedModel>,
  id: string,
  label?: string,
  isDefault?: boolean,
): void {
  const trimmedId = id.trim();
  if (!isOmpModelId(trimmedId)) return;
  const previous = models.get(trimmedId);
  const model: ProbedModel = { id: trimmedId };
  const resolvedLabel = label?.trim() || previous?.label;
  if (resolvedLabel) model.label = resolvedLabel;
  if (isDefault || previous?.isDefault) model.isDefault = true;
  models.set(trimmedId, model);
}

function collectOmpRoleModels(
  raw: unknown,
  models: Map<string, ProbedModel>,
): string | undefined {
  if (!isRecord(raw) || !isRecord(raw["modelRoles"])) return undefined;
  let defaultId: string | undefined;
  for (const [role, value] of Object.entries(raw["modelRoles"])) {
    if (typeof value !== "string") continue;
    const modelId = value.trim();
    if (!isOmpModelId(modelId)) continue;
    addOmpModel(models, modelId, undefined, role === "default");
    if (role === "default") defaultId = modelId;
  }
  return defaultId;
}

function collectOmpProviderModels(
  raw: unknown,
  models: Map<string, ProbedModel>,
): void {
  if (!isRecord(raw) || !isRecord(raw["providers"])) return;
  for (const [providerKey, provider] of Object.entries(raw["providers"])) {
    const providerId = providerKey.trim();
    if (!providerId || !isRecord(provider)) continue;

    const configuredModels = provider["models"];
    if (Array.isArray(configuredModels)) {
      for (const entry of configuredModels) {
        if (!isRecord(entry) || typeof entry["id"] !== "string") continue;
        const rawId = entry["id"].trim();
        const modelId = rawId.startsWith(`${providerId}/`)
          ? rawId
          : `${providerId}/${rawId}`;
        const label = typeof entry["name"] === "string" ? entry["name"] : undefined;
        addOmpModel(models, modelId, label);
      }
    }

    const modelOverrides = provider["modelOverrides"];
    if (isRecord(modelOverrides)) {
      for (const modelKey of Object.keys(modelOverrides)) {
        const modelId = modelKey.startsWith(`${providerId}/`)
          ? modelKey
          : `${providerId}/${modelKey}`;
        addOmpModel(models, modelId);
      }
    }
  }
}

function parseOmpConfig(text: string): unknown {
  return parseYaml(text) as unknown;
}

async function readOmpModelFile(file: string): Promise<unknown> {
  const text = await readFile(file, "utf8");
  return file.endsWith(".json") ? JSON.parse(text) as unknown : parseOmpConfig(text);
}

function ompNativeDefault(): ProbeResult {
  return {
    ok: true,
    models: [{ id: "", label: "OMP 默认模型", isDefault: true }],
    capabilities: {
      structuredEvents: true,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: true,
    },
  };
}

async function probeOmpModels(agentDir: string): Promise<ProbeResult> {
  try {
    const run = async (): Promise<ProbeResult> => {
      const models = new Map<string, ProbedModel>();
      let defaultId: string | undefined;

      try {
        const config = await readFile(path.join(agentDir, "config.yml"), "utf8");
        defaultId = collectOmpRoleModels(parseOmpConfig(config), models);
      } catch {
        // OMP has built-in models and can use its native default without config.yml.
      }

      for (const fileName of ["models.yml", "models.yaml", "models.json"]) {
        try {
          const configuredModels = await readOmpModelFile(path.join(agentDir, fileName));
          collectOmpProviderModels(configuredModels, models);
        } catch {
          // Invalid or absent custom model files do not disable OMP's built-in catalog.
        }
      }

      if (defaultId) {
        const defaultModel = models.get(defaultId);
        if (defaultModel) {
          models.set(defaultId, { ...defaultModel, isDefault: true });
        }
      }
      if (models.size === 0) return ompNativeDefault();

      return {
        ok: true,
        models: [...models.values()],
        capabilities: {
          structuredEvents: true,
          nativeResume: true,
          nonInteractivePrompt: true,
          explicitModel: true,
          toolEvents: true,
        },
      };
    };
    return await withTimeout(run(), 5000, "omp 模型探测超时");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `omp 探测失败：${message}` };
  }
}

function parseChunk(chunk: string, source: "stdout" | "stderr"): readonly AgentEvent[] {
  if (!chunk) return [];
  if (source === "stderr") {
    return [{ kind: "stderr", text: chunk }];
  }
  const events: AgentEvent[] = [];
  const lines = chunk.split("\n");
  let textBuffer = "";
  const flushText = () => {
    if (textBuffer) {
      events.push({ kind: "assistant_text", text: textBuffer });
      textBuffer = "";
    }
  };
  for (const line of lines) {
    if (!line.trim()) {
      textBuffer += "\n";
      continue;
    }
    const structured = parseStructuredLine(line);
    if (structured) {
      flushText();
      events.push(structured);
    } else {
      textBuffer += (textBuffer ? "\n" : "") + line;
    }
  }
  flushText();
  return events;
}

function buildArgsFor(
  id: CliId,
  options: PromptBuildOptions,
): readonly string[] {
  const extra = options.extraArgs ?? [];
  const modelArgs = options.model ? ["--model", options.model] : [];
  switch (id) {
    case "codex": {
      // codex exec [options] [PROMPT]；resume 传入 nativeSessionId。
      const args: string[] = ["exec", ...modelArgs, ...extra];
      if (options.nativeSessionId) {
        args.push("resume", options.nativeSessionId);
      }
      args.push(options.prompt);
      return Object.freeze(args);
    }
    case "claude": {
      const args: string[] = ["-p", ...modelArgs, ...extra];
      if (options.nativeSessionId) {
        args.push("--resume", options.nativeSessionId);
      }
      args.push(options.prompt);
      return Object.freeze(args);
    }
    case "pi": {
      const args: string[] = ["-p", ...modelArgs, ...extra];
      if (options.nativeSessionId) {
        args.push("--session", options.nativeSessionId);
      }
      args.push(options.prompt);
      return Object.freeze(args);
    }
    case "omp": {
      const args: string[] = ["-p", "--mode", "json", ...modelArgs, ...extra];
      if (options.nativeSessionId) {
        args.push("--resume", options.nativeSessionId);
      }
      args.push(options.prompt);
      return Object.freeze(args);
    }
  }
}

/** Build a fresh adapter registry, primarily for tests and embedded hosts. */
export function createCliAdapters(
  options: CliAdapterOptions = {},
): Readonly<Record<CliId, CliAdapter>> {
  const homeDir = options.homeDir ?? homedir();
  const baseEnv = options.env ?? process.env;
  const envFor = (id: CliId): NodeJS.ProcessEnv => ({
    ...baseEnv,
    ...options.agentEnvs?.[id],
  });
  const codexEnv = envFor("codex");
  const claudeEnv = envFor("claude");
  const piEnv = envFor("pi");
  const ompEnv = envFor("omp");

  const codexDir = codexConfigDir(homeDir, codexEnv);
  const claudeDir = claudeConfigDir(homeDir, claudeEnv);
  const piDir = piConfigDir(homeDir, piEnv);
  const ompDirs = ompConfigDirs(homeDir, ompEnv);

  const staticCapabilities: Record<CliId, CliCapabilities> = {
    codex: {
      structuredEvents: false,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: false,
    },
    claude: {
      structuredEvents: false,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: false,
    },
    pi: {
      structuredEvents: false,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: false,
    },
    omp: {
      structuredEvents: true,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: true,
    },
  };

  return Object.freeze({
    codex: Object.freeze({
      id: "codex",
      bin: "codex",
      configDir: codexDir,
      versionArgs: DEFAULT_VERSION_ARGS,
      interactiveArgs: Object.freeze([]),
      // 非交互模式必须走 exec 子命令：裸 `codex <prompt>` 是交互式 TUI，
      // 在 capture 模式下 stdin 不是终端，会直接报 "stdin is not a terminal"。
      promptArgs: (prompt: string) => ["exec", prompt],
      probeModels: () => probeCodexModels(codexDir),
      probeCapabilities: () => staticCapabilities.codex,
      buildPromptArgs: (promptOptions: PromptBuildOptions) => buildArgsFor("codex", promptOptions),
      parseOutputChunk: (chunk: string, source: "stdout" | "stderr") => parseChunk(chunk, source),
      defaultModel: () => undefined,
    }),
    claude: Object.freeze({
      id: "claude",
      bin: "claude",
      configDir: claudeDir,
      versionArgs: DEFAULT_VERSION_ARGS,
      interactiveArgs: Object.freeze([]),
      promptArgs: (prompt: string) => ["-p", prompt],
      probeModels: () => probeClaudeModels(claudeDir),
      probeCapabilities: () => staticCapabilities.claude,
      buildPromptArgs: (promptOptions: PromptBuildOptions) => buildArgsFor("claude", promptOptions),
      parseOutputChunk: (chunk: string, source: "stdout" | "stderr") => parseChunk(chunk, source),
      defaultModel: () => undefined,
    }),
    pi: Object.freeze({
      id: "pi",
      bin: "pi",
      configDir: piDir,
      versionArgs: DEFAULT_VERSION_ARGS,
      interactiveArgs: Object.freeze([]),
      promptArgs: (prompt: string) => ["-p", prompt],
      probeModels: () => probePiModels(piDir),
      probeCapabilities: () => staticCapabilities.pi,
      buildPromptArgs: (promptOptions: PromptBuildOptions) => buildArgsFor("pi", promptOptions),
      parseOutputChunk: (chunk: string, source: "stdout" | "stderr") => parseChunk(chunk, source),
      defaultModel: () => undefined,
    }),
    omp: Object.freeze({
      id: "omp",
      bin: "omp",
      configDir: ompDirs.rootDir,
      versionArgs: DEFAULT_VERSION_ARGS,
      interactiveArgs: Object.freeze([]),
      promptArgs: (prompt: string) => ["-p", prompt],
      probeModels: () => probeOmpModels(ompDirs.agentDir),
      probeCapabilities: () => staticCapabilities.omp,
      buildPromptArgs: (promptOptions: PromptBuildOptions) => buildArgsFor("omp", promptOptions),
      parseOutputChunk: (chunk: string, source: "stdout" | "stderr"): readonly AgentEvent[] => parseChunk(chunk, source),
      defaultModel: () => undefined,
    }),
  });
}

/** Default registry derived from the current user's home and environment. */
export const CLI_ADAPTERS: Readonly<Record<CliId, CliAdapter>> =
  createCliAdapters();

export function getCliAdapter(
  id: CliId,
  options?: CliAdapterOptions,
): CliAdapter {
  const adapters = options ? createCliAdapters(options) : CLI_ADAPTERS;
  return adapters[id];
}

export function getCliAdapters(
  options?: CliAdapterOptions,
): Readonly<Record<CliId, CliAdapter>> {
  return options ? createCliAdapters(options) : CLI_ADAPTERS;
}

export { CLI_IDS };
