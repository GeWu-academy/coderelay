export interface RuntimeStatus {
  coreVersion: string;
  protocolVersion: number;
  transport: string;
}

export interface CliCandidate {
  path: string;
  runtime: string;
  source: string;
  distro?: string;
  mountRoot?: string;
  version: string | null;
}

export interface CliDiagnostic {
  level: string;
  message: string;
}

export interface AgentEntry {
  id: string;
  label: string;
  enabled: boolean;
  isDefault: boolean;
  available: boolean;
  command: string;
  path: string;
  version: string | null;
  models: string[];
  runtime: string;
  distro?: string;
  source: string;
  candidates: CliCandidate[];
  diagnostics: CliDiagnostic[];
}

export interface CliCapabilities {
  structuredEvents: boolean;
  nativeResume: boolean;
  nonInteractivePrompt: boolean;
  explicitModel: boolean;
  toolEvents: boolean;
}

export interface ModelOption {
  cliId: string;
  modelId: string;
  label: string;
  description?: string;
  isDefault: boolean;
  isNativeDefault?: boolean;
  capabilities: CliCapabilities;
  strengths: string[];
  cost?: number;
  contextWindow?: number;
  available: boolean;
  reason?: string;
}

export interface ProbeDisplay {
  cliId: string;
  status: string;
  models: ModelOption[];
  reason?: string;
}

export interface ModelCatalog {
  probes: ProbeDisplay[];
  options: ModelOption[];
}

export interface PermissionOption {
  id: string;
  label: string;
  description: string;
  dangerous: boolean;
}

export interface AgentPermissions {
  cliId: string;
  options: PermissionOption[];
}

export interface DiscoveryPayload {
  cwd: string;
  configPath: string | null;
  defaultAgent: string;
  routingModes: string[];
  agents: AgentEntry[];
  catalog: ModelCatalog;
  permissions: AgentPermissions[];
  recentWorkspaces: string[];
}

export interface RouteRequest {
  prompt: string;
  files?: string[];
  language?: string;
  contextSize?: number;
  requiredStrengths?: string[];
}

export interface WorkspaceRequest {
  cwd?: string;
  configPath?: string;
}

export interface RoutePreview {
  agent: string;
  model?: string;
  reasons: string[];
}

export interface AgentEvent {
  kind: string;
  text?: string;
  tool?: string;
  reason?: string;
  message?: string;
  exitCode?: number | null;
}

export interface AgentRunResult {
  status: string;
  code: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
  text: string;
  stderrTail: string;
  events: AgentEvent[];
}

export interface StartRunResponse {
  runId: string;
  sessionId: string;
  agent: string;
  model?: string;
  reasons: string[];
}

export interface RunEventPayload {
  runId: string;
  sessionId: string;
  event: AgentEvent;
}

export interface RunCompletedPayload {
  runId: string;
  sessionId: string;
  result: AgentRunResult;
}

export interface SessionRecord {
  id: string;
  cliId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  workspace?: string;
}

export interface SessionTurn {
  id: number;
  sessionId: string;
  cliId: string;
  prompt: string;
  output: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  createdAt: number;
  modelId?: string;
  protocol?: string;
  reusedNative?: boolean;
  status?: string;
  eventSummary?: string;
  contextSource?: string;
}

export interface SessionDetail {
  session: SessionRecord;
  turns: SessionTurn[];
}

export interface ConfigSource {
  path: string;
  exists: boolean;
  raw: string;
}

export interface JevSettings {
  stored: boolean;
  environmentConfigured: boolean;
}

export interface SessionUpdatedPayload {
  sessionId: string;
  turnId: number | null;
}

export interface RouteForm {
  prompt: string;
  mode: string;
  agent: string;
  model: string;
  permission: string;
}

export const WORKSPACE_VIEWS = ["workspace", "sessions", "stats", "config", "apikeys"] as const;
export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];

export function isWorkspaceView(value: unknown): value is WorkspaceView {
  return (WORKSPACE_VIEWS as readonly unknown[]).includes(value);
}

export const CONVERSATION_VIEWS = ["workspace"] as const;
export type ConversationView = (typeof CONVERSATION_VIEWS)[number];

export function isConversationView(value: unknown): value is ConversationView {
  return (CONVERSATION_VIEWS as readonly unknown[]).includes(value);
}

export const TIME_PERIODS = ["morning", "afternoon", "evening", "late_night"] as const;
export type TimePeriod = (typeof TIME_PERIODS)[number];

export function isTimePeriod(value: unknown): value is TimePeriod {
  return (TIME_PERIODS as readonly unknown[]).includes(value);
}

export const THEME_PRESET_IDS = [
  "light",
  "dark",
  "midnight",
  "warm",
  "slate",
  "cyan",
  "sky",
  "pink",
  "red",
  "system",
] as const;
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return (THEME_PRESET_IDS as readonly unknown[]).includes(value);
}

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = "light";

export interface ThemePresetPreviewColors {
  readonly canvas: string;
  readonly sidebar: string;
  readonly surface: string;
  readonly ink: string;
  readonly accent: string;
  readonly border: string;
}

export interface ThemePreset {
  readonly id: ThemePresetId;
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
  readonly mode: "light" | "dark" | "system";
  readonly preview: ThemePresetPreviewColors;
}

export const THEME_PRESETS: readonly ThemePreset[] = Object.freeze([
  {
    id: "light",
    name: "浅色",
    subtitle: "默认",
    description: "ChatGPT 经典纯白，明亮开阔",
    mode: "light",
    preview: Object.freeze({
      canvas: "#ffffff",
      sidebar: "#fafafa",
      surface: "#ffffff",
      ink: "#18181b",
      accent: "#18181b",
      border: "rgba(0, 0, 0, 0.08)",
    }),
  },
  {
    id: "dark",
    name: "深色",
    subtitle: "ChatGPT",
    description: "经典炭灰质感，深邃沉浸",
    mode: "dark",
    preview: Object.freeze({
      canvas: "#212121",
      sidebar: "#171717",
      surface: "#2f2f2f",
      ink: "#ececec",
      accent: "#ececec",
      border: "rgba(255, 255, 255, 0.1)",
    }),
  },
  {
    id: "midnight",
    name: "极夜黑",
    subtitle: "OLED",
    description: "纯黑高对比，黑曜石极简质感",
    mode: "dark",
    preview: Object.freeze({
      canvas: "#000000",
      sidebar: "#09090b",
      surface: "#121215",
      ink: "#fafafa",
      accent: "#ffffff",
      border: "rgba(255, 255, 255, 0.12)",
    }),
  },
  {
    id: "warm",
    name: "暖米色",
    subtitle: "护眼",
    description: "羊皮纸温润质感，舒适久读",
    mode: "light",
    preview: Object.freeze({
      canvas: "#faf7f0",
      sidebar: "#f4eee3",
      surface: "#fdfcf9",
      ink: "#2c2825",
      accent: "#2c2825",
      border: "rgba(68, 63, 59, 0.12)",
    }),
  },
  {
    id: "slate",
    name: "极光蓝灰",
    subtitle: "Nordic",
    description: "科技冷调蓝灰，现代极客格调",
    mode: "dark",
    preview: Object.freeze({
      canvas: "#0f172a",
      sidebar: "#111a2a",
      surface: "#1e293b",
      ink: "#f1f5f9",
      accent: "#38bdf8",
      border: "rgba(148, 163, 184, 0.16)",
    }),
  },
  {
    id: "cyan",
    name: "青色",
    subtitle: "竹青",
    description: "碧竹澄青明亮，清雅灵动之韵",
    mode: "light",
    preview: Object.freeze({
      canvas: "#f0fdfa",
      sidebar: "#e6f7f4",
      surface: "#ffffff",
      ink: "#0f3b37",
      accent: "#0d9488",
      border: "rgba(13, 148, 136, 0.16)",
    }),
  },
  {
    id: "sky",
    name: "天蓝色",
    subtitle: "晴空",
    description: "蔚蓝如洗澄空，开阔明澈视野",
    mode: "light",
    preview: Object.freeze({
      canvas: "#f0f9ff",
      sidebar: "#e8f4fc",
      surface: "#ffffff",
      ink: "#0c2d48",
      accent: "#0284c7",
      border: "rgba(2, 132, 199, 0.16)",
    }),
  },
  {
    id: "pink",
    name: "粉色",
    subtitle: "落樱",
    description: "温柔晚樱浅粉，甜美柔和意境",
    mode: "light",
    preview: Object.freeze({
      canvas: "#fdf2f8",
      sidebar: "#fceef5",
      surface: "#ffffff",
      ink: "#4a1525",
      accent: "#db2777",
      border: "rgba(219, 39, 119, 0.16)",
    }),
  },
  {
    id: "red",
    name: "红色",
    subtitle: "赤霞",
    description: "绯红霞光映照，热烈醒目气质",
    mode: "light",
    preview: Object.freeze({
      canvas: "#fff5f5",
      sidebar: "#fdedec",
      surface: "#ffffff",
      ink: "#3b0d0c",
      accent: "#dc2626",
      border: "rgba(220, 38, 38, 0.16)",
    }),
  },
  {
    id: "system",
    name: "跟随系统",
    subtitle: "自动",
    description: "根据系统外观设置自动切换",
    mode: "system",
    preview: Object.freeze({
      canvas: "#ffffff",
      sidebar: "#212121",
      surface: "#f4f4f5",
      ink: "#18181b",
      accent: "#18181b",
      border: "rgba(0, 0, 0, 0.1)",
    }),
  },
]);

export interface WelcomeTimeSnapshot {
  period: TimePeriod;
  greeting: string;
  formattedTime: string;
  formattedDate: string;
  encouragement: string;
}

export interface WorkbenchState {
  discovery: DiscoveryPayload | null;
  runtime: RuntimeStatus | null;
  loading: boolean;
  error: string | null;
  running: boolean;
  runId: string | null;
  output: string;
  activity: string[];
  result: RunCompletedPayload["result"] | null;
  preview: RoutePreview | null;
  view: WorkspaceView;
  recentWorkspaces: string[];
  sessions: SessionRecord[];
  sessionDetail: SessionDetail | null;
  activeSessionId: string | null;
  configSource: ConfigSource | null;
  configDraft: string;
  configBusy: boolean;
  jevSettings: JevSettings | null;
  jevApiKeyInput: string;
  jevBusy: boolean;
  configNotice: string | null;
}

