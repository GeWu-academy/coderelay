import type {
  AgentEntry,
  ConfigSource,
  DiscoveryPayload,
  FileTreeEntry,
  JevSettings,
  ModelOption,
  RoutePreview,
  RuntimeStatus,
  SessionDetail,
  SessionRecord,
  StartRunResponse,
  WorkspaceFileContent,
} from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (
        cmd: string,
        args?: Record<string, unknown>,
        options?: unknown,
      ) => Promise<unknown>;
    };
  }
}

const mockCatalogOptions: ModelOption[] = [
  {
    cliId: "codex",
    modelId: "qwen-3.8-flash",
    label: "Qwen 3.8 Flash",
    description: "极致低延迟与高吞吐的快速响应模型",
    isDefault: true,
    isNativeDefault: true,
    capabilities: {
      structuredEvents: true,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: true,
    },
    strengths: ["fast", "chat"],
    cost: 0.001,
    contextWindow: 128000,
    available: true,
  },
  {
    cliId: "codex",
    modelId: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    description: "深度推理与高质量代码生成",
    isDefault: false,
    isNativeDefault: false,
    capabilities: {
      structuredEvents: true,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: true,
    },
    strengths: ["reasoning", "coding"],
    cost: 0.002,
    contextWindow: 64000,
    available: true,
  },
  {
    cliId: "claude",
    modelId: "claude-3-7-sonnet",
    label: "Claude 3.7 Sonnet",
    description: "前沿架构设计与长上下文混合推理",
    isDefault: true,
    isNativeDefault: true,
    capabilities: {
      structuredEvents: true,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: true,
    },
    strengths: ["architecture", "reasoning", "refactor"],
    cost: 0.015,
    contextWindow: 200000,
    available: true,
  },
  {
    cliId: "claude",
    modelId: "claude-3-5-haiku",
    label: "Claude 3.5 Haiku",
    description: "快速轻量的指令执行与单步修复",
    isDefault: false,
    isNativeDefault: false,
    capabilities: {
      structuredEvents: true,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: true,
    },
    strengths: ["fast", "scripts"],
    cost: 0.003,
    contextWindow: 200000,
    available: true,
  },
];

const mockAgents: AgentEntry[] = [
  {
    id: "codex",
    label: "Codex CLI",
    enabled: true,
    isDefault: true,
    available: true,
    command: "codex",
    path: "/usr/local/bin/codex",
    version: "0.9.1",
    models: ["qwen-3.8-flash", "deepseek-v4-flash"],
    runtime: "local",
    source: "path",
    candidates: [
      {
        path: "/usr/local/bin/codex",
        runtime: "local",
        source: "path",
        version: "0.9.1",
      },
    ],
    diagnostics: [],
  },
  {
    id: "claude",
    label: "Claude Code",
    enabled: true,
    isDefault: false,
    available: true,
    command: "claude",
    path: "/usr/local/bin/claude",
    version: "1.0.2",
    models: ["claude-3-7-sonnet", "claude-3-5-haiku"],
    runtime: "local",
    source: "path",
    candidates: [
      {
        path: "/usr/local/bin/claude",
        runtime: "local",
        source: "path",
        version: "1.0.2",
      },
    ],
    diagnostics: [],
  },
];

const defaultSessionRecord: SessionRecord = {
  id: "sess-default",
  cliId: "codex",
  title: "CodeRelay 控制平面初始化",
  createdAt: Date.now() - 86400000 * 20,
  updatedAt: Date.now() - 86400000 * 20 + 3600000,
  workspace: "/Users/allure/Desktop/coderelay",
};

const mockSessions: SessionRecord[] = [
  defaultSessionRecord,
  {
    id: "sess-001",
    cliId: "claude",
    title: "设计三级联动智能路由 (Mode / Agent / Model)",
    createdAt: Date.now() - 3600000 * 2,
    updatedAt: Date.now() - 1800000,
    workspace: "/Users/allure/Desktop/coderelay",
  },
  {
    id: "sess-002",
    cliId: "codex",
    title: "迁移 ThemePreset 系统并补齐极夜暗黑配色",
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 43200000,
    workspace: "/Users/allure/Desktop/coderelay",
  },
  {
    id: "sess-003",
    cliId: "claude",
    title: "优化本地 SQLite 会话存储与跨工作区索引性能",
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 86400000,
    workspace: "/Users/allure/Desktop/coderelay",
  },
  {
    id: "sess-004",
    cliId: "codex",
    title: "构建自适应模型调度算法与低延迟熔断机制",
    createdAt: Date.now() - 86400000 * 3,
    updatedAt: Date.now() - 86400000 * 3 + 7200000,
    workspace: "/Users/allure/Desktop/coderelay",
  },
  {
    id: "sess-005",
    cliId: "claude",
    title: "集成 GitHub 风格贡献活动热力图组件",
    createdAt: Date.now() - 86400000 * 4,
    updatedAt: Date.now() - 86400000 * 4 + 5400000,
    workspace: "/Users/allure/Desktop/coderelay",
  },
  {
    id: "sess-006",
    cliId: "codex",
    title: "验证多工作区权限持久化与沙箱安全边界",
    createdAt: Date.now() - 86400000 * 6,
    updatedAt: Date.now() - 86400000 * 6 + 3600000,
    workspace: "/Users/allure/Desktop/coderelay",
  },
  {
    id: "sess-007",
    cliId: "claude",
    title: "实现多系列折线图平滑贝塞尔曲线渲染",
    createdAt: Date.now() - 86400000 * 8,
    updatedAt: Date.now() - 86400000 * 8 + 4800000,
    workspace: "/Users/allure/Desktop/coderelay",
  },
  {
    id: "sess-008",
    cliId: "codex",
    title: "端到端自动化测试与 SSOT 单一数据源校验",
    createdAt: Date.now() - 86400000 * 11,
    updatedAt: Date.now() - 86400000 * 11 + 9000000,
    workspace: "/Users/allure/Desktop/coderelay",
  },
];

const mockDiscovery: DiscoveryPayload = {
  cwd: "/Users/allure/Desktop/coderelay",
  configPath: "/Users/allure/Desktop/coderelay/.coderelay/config.yaml",
  defaultAgent: "codex",
  routingModes: ["auto", "cost", "performance", "manual"],
  agents: mockAgents,
  catalog: {
    probes: [
      {
        cliId: "codex",
        status: "ok",
        models: mockCatalogOptions.filter((o) => o.cliId === "codex"),
      },
      {
        cliId: "claude",
        status: "ok",
        models: mockCatalogOptions.filter((o) => o.cliId === "claude"),
      },
    ],
    options: mockCatalogOptions,
  },
  permissions: [
    {
      cliId: "codex",
      options: [
        { id: "default", label: "默认", description: "沿用该 CLI 自身的配置", dangerous: false },
        { id: "read-only", label: "只读", description: "沙箱只读，只分析不修改（最接近 plan）", dangerous: false },
        { id: "workspace-write", label: "工作区可写", description: "沙箱内可修改工作区文件", dangerous: false },
        { id: "approve-for-me", label: "自动审查", description: "审批请求交给自动审查，工作区可写沙箱", dangerous: false },
        { id: "full-access", label: "完全放行", description: "跳过所有确认且不使用沙箱", dangerous: true },
      ],
    },
    {
      cliId: "claude",
      options: [
        { id: "default", label: "默认", description: "沿用该 CLI 自身的配置", dangerous: false },
        { id: "plan", label: "Plan", description: "只规划，不修改文件", dangerous: false },
        { id: "acceptEdits", label: "自动接受编辑", description: "自动接受文件编辑，其余操作仍需许可", dangerous: false },
        { id: "auto", label: "Auto", description: "由分类器自动判断是否放行", dangerous: false },
        { id: "bypassPermissions", label: "完全放行", description: "跳过所有权限检查", dangerous: true },
      ],
    },
    {
      cliId: "pi",
      options: [
        { id: "default", label: "默认", description: "沿用该 CLI 自身的配置", dangerous: false },
        { id: "read-only", label: "只读", description: "仅启用 read/grep/find/ls，禁用 bash、edit、write", dangerous: false },
      ],
    },
    {
      cliId: "omp",
      options: [
        { id: "default", label: "默认", description: "沿用该 CLI 自身的配置", dangerous: false },
        { id: "always-ask", label: "总是询问", description: "每次工具调用都需确认", dangerous: false },
        { id: "write", label: "写入需确认", description: "approvalMode=write", dangerous: false },
        { id: "yolo", label: "完全放行", description: "自动批准所有工具调用", dangerous: true },
      ],
    },
  ],
  recentWorkspaces: [
    "/Users/allure/Desktop/coderelay",
    "/Users/allure/Projects/agent-workspace",
    "/Users/allure/Code/kernel-optimizer",
  ],
};

const mockRuntime: RuntimeStatus = {
  coreVersion: "0.4.4",
  protocolVersion: 1,
  transport: "browser-preview",
};

const mockConfigSource: ConfigSource = {
  path: "/Users/allure/Desktop/coderelay/.coderelay/config.yaml",
  exists: true,
  raw: `# CodeRelay 本地配置文件
defaultAgent: "codex"
defaultMode: "auto"
models:
  - id: "qwen-3.8-flash"
    strengths: ["fast", "chat"]
  - id: "claude-3-7-sonnet"
    strengths: ["architecture", "reasoning"]
`,
};

let jevSettingsState: JevSettings = {
  stored: true,
  environmentConfigured: false,
};

let sessionsState: SessionRecord[] = [...mockSessions];

export async function mockInvoke(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  switch (cmd) {
    case "runtime_status":
      return mockRuntime;
    case "discover": {
      const req = (args.request as { cwd?: string | null } | undefined) ?? {};
      const cwd = typeof req.cwd === "string" ? req.cwd.trim() : "";
      const recentWorkspaces = cwd
        ? Array.from(new Set([cwd, ...mockDiscovery.recentWorkspaces]))
        : mockDiscovery.recentWorkspaces;
      return {
        ...mockDiscovery,
        cwd,
        recentWorkspaces,
      };
    }
    case "record_workspace": {
      const ws = typeof args.workspace === "string" ? args.workspace.trim() : "";
      if (ws) {
        mockDiscovery.recentWorkspaces = Array.from(
          new Set([ws, ...mockDiscovery.recentWorkspaces]),
        );
      }
      return null;
    }
    case "list_sessions":
      return sessionsState;
    case "list_recent_workspaces":
      return mockDiscovery.recentWorkspaces;
    case "get_session": {
      const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
      const found =
        sessionsState.find((s) => s.id === sessionId) ??
        sessionsState[0] ??
        defaultSessionRecord;

      const modelId =
        found.cliId === "codex"
          ? found.id === "sess-004" || found.id === "sess-008"
            ? "deepseek-v4-flash"
            : "qwen-3.8-flash"
          : found.id === "sess-005"
            ? "claude-3-5-haiku"
            : "claude-3-7-sonnet";

      const turns: SessionDetail["turns"] = [
        {
          id: 1,
          sessionId: found.id,
          cliId: found.cliId,
          prompt: found.title,
          output: `已通过 ${found.cliId} 完成任务分析：\n\n1. 扫描当前工作区结构\n2. 校验配置定义与单一数据源约束\n3. 单元测试全量通过`,
          exitCode: 0,
          signal: null,
          durationMs: 1420,
          createdAt: found.createdAt,
          modelId,
          protocol: "structured",
          reusedNative: false,
          status: "success",
          eventSummary: "执行成功，用时 1.42s",
        },
      ];

      if (found.updatedAt > found.createdAt) {
        turns.push({
          id: 2,
          sessionId: found.id,
          cliId: found.cliId,
          prompt: "继续优化执行细节并更新对话记录",
          output: "优化已完成，所有指标已上报。",
          exitCode: 0,
          signal: null,
          durationMs: 890,
          createdAt: found.updatedAt,
          modelId,
          protocol: "structured",
          reusedNative: true,
          status: "success",
          eventSummary: "后续交互执行成功",
        });
      }

      const detail: SessionDetail = {
        session: found,
        turns,
      };
      return detail;
    }
    case "delete_session": {
      const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
      sessionsState = sessionsState.filter((s) => s.id !== sessionId);
      return true;
    }
    case "delete_workspace": {
      const req = (args.request as { workspace?: string } | undefined) ?? {};
      const ws = (req.workspace ?? "").trim();
      if (ws) {
        sessionsState = sessionsState.filter((s) => s.workspace !== ws);
        mockDiscovery.recentWorkspaces = mockDiscovery.recentWorkspaces.filter(
          (item) => item !== ws,
        );
      }
      return true;
    }
    case "delete_workspace_sessions": {
      sessionsState = [];
      return 1;
    }
    case "read_config_source":
      return mockConfigSource;
    case "save_config":
      return mockConfigSource.path;
    case "get_jev_settings":
      return jevSettingsState;
    case "save_jev_api_key":
      jevSettingsState = { ...jevSettingsState, stored: true };
      return jevSettingsState;
    case "clear_jev_api_key":
      jevSettingsState = { ...jevSettingsState, stored: false };
      return jevSettingsState;
    case "route_preview": {
      const preview: RoutePreview = {
        agent: "codex",
        model: "qwen-3.8-flash",
        reasons: ["根据提示词长度与复杂度自适应推荐", "极低延迟模型，优先吞吐"],
      };
      return preview;
    }
    case "start_run": {
      const resp: StartRunResponse = {
        runId: `run-${Date.now()}`,
        sessionId: `sess-${Date.now()}`,
        agent: "codex",
        model: "qwen-3.8-flash",
        reasons: ["自适应路由成功匹配"],
      };
      return resp;
    }
    case "cancel_run":
      return true;
    case "pick_workspace":
      return "/Users/allure/Desktop/coderelay";
    case "list_directory": {
      const req = (args.request as { relativePath?: string | null } | undefined) ?? {};
      const rel = (req.relativePath ?? "").trim();
      if (!rel) {
        const rootEntries: FileTreeEntry[] = [
          { name: "src", path: "src", isDir: true, size: 0, extension: null },
          { name: "package.json", path: "package.json", isDir: false, size: 512, extension: "json" },
          { name: "README.md", path: "README.md", isDir: false, size: 1024, extension: "md" },
        ];
        return rootEntries;
      }
      if (rel === "src") {
        const srcEntries: FileTreeEntry[] = [
          { name: "App.tsx", path: "src/App.tsx", isDir: false, size: 420, extension: "tsx" },
          { name: "main.ts", path: "src/main.ts", isDir: false, size: 180, extension: "ts" },
        ];
        return srcEntries;
      }
      return [];
    }
    case "read_workspace_file": {
      const req = (args.request as { relativePath?: string } | undefined) ?? {};
      const rel = req.relativePath ?? "README.md";
      const name = rel.split("/").pop() ?? rel;
      const ext = name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? null) : null;
      const content =
        rel === "src/App.tsx"
          ? 'export function App() {\n  return <main>CodeRelay</main>;\n}\n'
          : rel === "package.json"
            ? '{\n  "name": "coderelay",\n  "version": "0.4.4"\n}\n'
            : "# CodeRelay\n\nWorkspace file preview.\n";
      const result: WorkspaceFileContent = {
        path: rel,
        name,
        content,
        size: content.length,
        lineCount: content.split("\n").length - 1,
        isBinary: false,
        truncated: false,
        extension: ext,
      };
      return result;
    }
    case "terminal_create": {
      const cwd =
        typeof args.cwd === "string" && args.cwd.trim()
          ? args.cwd.trim()
          : mockDiscovery.cwd;
      return {
        terminalId: `mock-term-${Date.now()}`,
        shell: "/bin/zsh",
        cwd,
      };
    }
    case "terminal_write":
    case "terminal_resize":
    case "terminal_close":
      return null;
    case "git_status":
      return {
        isRepo: true,
        repoRoot: "/Users/demo/coderelay",
        branch: "feat/scm-view",
        upstream: "origin/feat/scm-view",
        ahead: 1,
        behind: 0,
        detached: false,
        entries: [
          {
            path: "src/App.tsx",
            origPath: null,
            indexStatus: "M",
            worktreeStatus: ".",
            staged: true,
            unstaged: false,
            untracked: false,
            conflicted: false,
          },
          {
            path: "src/components/ScmView.tsx",
            origPath: null,
            indexStatus: "?",
            worktreeStatus: "?",
            staged: false,
            unstaged: false,
            untracked: true,
            conflicted: false,
          },
        ],
      };
    case "git_diff": {
      const req = (args.request ?? {}) as { path?: string; staged?: boolean };
      return {
        path: req.path ?? "src/App.tsx",
        staged: Boolean(req.staged),
        diff: "diff --git a/src/App.tsx b/src/App.tsx\n--- a/src/App.tsx\n+++ b/src/App.tsx\n@@ -1,2 +1,3 @@\n export function App() {\n+  // SCM route added\n   return <main>CodeRelay</main>;\n }",
        isBinary: false,
        additions: 1,
        deletions: 0,
      };
    }
    case "git_branches":
      return [
        {
          name: "feat/scm-view",
          fullName: "heads/feat/scm-view",
          isRemote: false,
          isCurrent: true,
          upstream: "origin/feat/scm-view",
          lastCommitOid: "a1b2c3d",
          committerDate: 1763700000,
        },
        {
          name: "main",
          fullName: "heads/main",
          isRemote: false,
          isCurrent: false,
          upstream: "origin/main",
          lastCommitOid: "9f8e7d6",
          committerDate: 1763690000,
        },
        {
          name: "origin/main",
          fullName: "remotes/origin/main",
          isRemote: true,
          isCurrent: false,
          upstream: null,
          lastCommitOid: "9f8e7d6",
          committerDate: 1763690000,
        },
      ];
    case "git_stage":
    case "git_unstage":
    case "git_discard":
    case "git_clear_output_log":
      return null;
    case "git_commit":
    case "git_undo_last_commit":
    case "git_discard_all":
    case "git_checkout":
    case "git_delete_branch":
    case "git_rename_branch":
    case "git_merge_branch":
    case "git_rebase_branch":
    case "git_sync":
    case "git_init":
    case "git_add_remote":
    case "git_remove_remote":
    case "git_stash_push":
    case "git_stash_apply":
    case "git_stash_pop":
    case "git_stash_drop":
    case "git_stash_clear":
    case "git_create_tag":
    case "git_delete_tag":
      return { ok: true, message: "Mock git action completed" };
    case "git_clone":
      return {
        ok: true,
        message: "Mock repository cloned",
        clonedPath: "/Users/allure/Desktop/cloned-repo",
      };
    case "git_remotes":
      return [
        {
          name: "origin",
          fetchUrl: "https://github.com/google/coderelay.git",
          pushUrl: "https://github.com/google/coderelay.git",
        },
      ];
    case "git_stashes":
      return [
        {
          reference: "stash@{0}",
          message: "WIP on main: mock stash",
          timestamp: 1763700000,
        },
      ];
    case "git_tags":
      return [
        {
          name: "v0.4.7",
          oid: "a1b2c3d",
          creatorDate: 1763700000,
          message: "Release v0.4.7",
        },
      ];
    case "git_output_log":
      return [
        {
          id: 1,
          timestampMs: Date.now(),
          cwd: "/Users/allure/Desktop/coderelay",
          command: "git status --porcelain=v2 --branch --untracked-files=all",
          exitCode: 0,
          stdout: "# branch.head main",
          stderr: "",
        },
      ];
    case "git_generate_commit_message":
      return "feat(desktop): add source control view with branch management";
    default:
      console.warn(`[mockTauri] Unhandled command: ${cmd}`);
      return null;
  }
}

if (typeof window !== "undefined" && !window.__TAURI_INTERNALS__) {
  window.__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args?: Record<string, unknown>) =>
      mockInvoke(cmd, args ?? {}),
  };
}
