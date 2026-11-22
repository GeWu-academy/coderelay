export const PROTOCOL_VERSION = 1;

export const METHODS = {
  status: "status",
  discoverAgents: "discoverAgents",
  getModelCatalog: "getModelCatalog",
  route: "route",
  startRun: "startRun",
  cancelRun: "cancelRun",
  listRecentWorkspaces: "listRecentWorkspaces",
  listSessions: "listSessions",
  getSession: "getSession",
  readConfig: "readConfig",
  saveConfig: "saveConfig",
} as const;

export type Method = (typeof METHODS)[keyof typeof METHODS];

export type RoutingMode = "local" | "manual" | "jev";
export type ModelStrength =
  | "coding"
  | "reasoning"
  | "long-context"
  | "tool-use"
  | "fast"
  | "cheap"
  | "creative"
  | "multimodal";

export interface WorkspaceParams {
  cwd?: string;
  configPath?: string;
}

export interface RouteRequest {
  prompt: string;
  files?: string[];
  language?: string;
  contextSize?: number;
  requiredStrengths?: ModelStrength[];
}

export interface CliCapabilities {
  structuredEvents: boolean;
  nativeResume: boolean;
  nonInteractivePrompt: boolean;
  explicitModel: boolean;
  toolEvents: boolean;
}

export interface CliCandidate {
  path: string;
  runtime: string;
  source: string;
  version: string | null;
}

export interface CliDiagnostic {
  level: string;
  message: string;
}

export interface DetectedCli {
  id: string;
  bin: string;
  path: string;
  version: string | null;
  available: boolean;
  runtime: string;
  source: string;
  candidates: CliCandidate[];
  diagnostics: CliDiagnostic[];
}

export interface StatusResult {
  coreVersion: string;
  protocolVersion: number;
  transport: string;
}

export interface DiscoverAgentsResult {
  cwd: string;
  configPath: string | null;
  defaultAgent: string;
  routingModes: RoutingMode[];
  detected: DetectedCli[];
}

export interface ModelOption {
  cliId: string;
  modelId: string;
  label: string;
  description?: string;
  isDefault: boolean;
  isNativeDefault?: boolean;
  capabilities: CliCapabilities;
  strengths: ModelStrength[];
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

export interface RouteParams {
  workspace?: WorkspaceParams;
  request: RouteRequest;
  mode?: RoutingMode;
  agent?: string;
  model?: string;
}

export interface RouteResult {
  agent: string;
  model?: string;
  reasons: string[];
}

export interface StartRunParams extends RouteParams {
  timeoutMs?: number;
  sessionId?: string;
}

export interface StartRunResult {
  runId: string;
  sessionId: string;
  agent: string;
  model?: string;
  reasons: string[];
}

export interface CancelRunResult {
  cancelled: boolean;
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

export interface SessionDetailResult {
  session: SessionRecord;
  turns: SessionTurn[];
}

export interface ConfigSourceResult {
  path: string;
  exists: boolean;
  raw: string;
}

export interface SaveConfigParams {
  workspace?: WorkspaceParams;
  raw: string;
}

export interface SaveConfigResult {
  path: string;
}

export interface SessionStartedEvent {
  kind: "session_started";
  cliId: string;
  model?: string;
  protocol: "structured" | "text";
  nativeSessionId?: string;
}

export interface StatusEvent {
  kind: "status";
  text: string;
}

export interface ThinkingEvent {
  kind: "thinking";
  text: string;
}

export interface AssistantTextEvent {
  kind: "assistant_text";
  text: string;
}

export interface ToolStartedEvent {
  kind: "tool_started";
  tool: string;
}

export interface ToolFinishedEvent {
  kind: "tool_finished";
  tool: string;
  ok: boolean;
}

export interface StderrEvent {
  kind: "stderr";
  text: string;
}

export interface CompletedEvent {
  kind: "completed";
  text: string;
  exitCode: number | null;
}

export interface FailedEvent {
  kind: "failed";
  message: string;
  exitCode: number | null;
}

export interface AbortedEvent {
  kind: "aborted";
  reason: string;
}

export type AgentEvent =
  | SessionStartedEvent
  | StatusEvent
  | ThinkingEvent
  | AssistantTextEvent
  | ToolStartedEvent
  | ToolFinishedEvent
  | StderrEvent
  | CompletedEvent
  | FailedEvent
  | AbortedEvent;

export type AgentRunStatus =
  | "completed"
  | "failed"
  | "timeout"
  | "aborted"
  | "spawn-error";

export interface AgentRunResult {
  status: AgentRunStatus;
  code: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
  text: string;
  stderrTail: string;
  events: AgentEvent[];
}

export interface RequestEnvelope {
  protocolVersion: number;
  requestId: string;
  method: Method;
  params?: unknown;
}

export interface ProtocolErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ResponseEnvelope {
  status: "ok" | "error";
  protocolVersion: number;
  requestId: string;
  result?: unknown;
  error?: ProtocolErrorBody;
}

export interface EventEnvelope {
  protocolVersion: number;
  runId: string;
  sessionId: string;
  event: AgentEvent;
}

export interface RunCompletedEnvelope {
  protocolVersion: number;
  runId: string;
  sessionId: string;
  result: AgentRunResult;
}
