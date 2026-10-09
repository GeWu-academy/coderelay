import { statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ThemeProvider as InkThemeProvider } from "@inkjs/ui";
import { Box, Text, useInput, useWindowSize } from "ink";

import { CLI_IDS, type CliId, type DetectedCli } from "../models/cli";
import { cliDiagnostics } from "../models/cli";
import { isAgentId } from "../agents/registry";
import {
  installHintLines,
  installPlatformFor,
} from "../models/install-guide";
import type { SessionTurn } from "../models/session";
import type { ActivationOption } from "../config/activation";
import type { ModelOption, ProbeDisplay } from "../agents/model-catalog";
import type { RoutingMode } from "../config/schema";
import { inkTheme } from "./ink-theme";
import { theme } from "./theme";
import {
  ActivationView,
  isSelectable as isActivationSelectable,
  moveCursor as moveActivationCursor,
  type ActivationMode,
} from "./components/ActivationView";
import { AppHeader } from "./components/AppHeader";
import { ChatView } from "./components/ChatView";
import { CliList, cliDisplayName } from "./components/CliList";
import { HintBar, type HintContext } from "./components/HintBar";
import { ScanningView } from "./components/ScanningView";
import { StageBar, type Stage } from "./components/StageBar";
import {
  findSlashCommand,
  matchSlashCommands,
  SLASH_HELP,
} from "./slash-commands";

export type LaunchRequest =
  | { readonly id: CliId; readonly mode: "prompt"; readonly prompt: string }
  | { readonly id: CliId; readonly mode: "interactive" };

/** 统一执行状态机：idle/probing/activating/selecting/starting/running/completed/failed/aborted。 */
export type AgentPhase =
  | "idle"
  | "probing"
  | "activating"
  | "selecting"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "aborted";

/** 正在执行的任务：加载态与位置层都靠它回答「现在是谁在跑」。live* 为流式实时字段。 */
export interface RunningTask {
  readonly id: CliId;
  readonly prompt: string;
  readonly startedAt: number;
  readonly modelId?: string;
  readonly liveText?: string;
  readonly statusText?: string;
  readonly tool?: string;
}

/**  terminal 状态（completed/failed/aborted）的一次性展示。 */
export interface PhaseResult {
  readonly phase: "completed" | "failed" | "aborted";
  readonly message: string;
}

export interface AppProps {
  readonly clis: readonly DetectedCli[];
  readonly isScanning?: boolean;
  readonly initialId?: CliId;
  readonly turns?: readonly SessionTurn[];
  readonly running?: RunningTask | null;
  readonly onLaunch: (request: LaunchRequest) => void;
  readonly onAbort?: () => void;
  readonly onNewSession?: () => void;
  readonly onExit: () => void;
  /** 统一状态机（可选，缺省时由 running/screen 推导，保持旧调用兼容）。 */
  readonly phase?: AgentPhase;
  /** probing 阶段四 CLI 独立状态。 */
  readonly probes?: readonly ProbeDisplay[];
  /** activating 阶段的行；缺省或为空时不进入激活屏。 */
  readonly activationOptions?: readonly ActivationOption[];
  /** activating 阶段是本机首次确认（confirm）还是 /activate 管理（manage）。 */
  readonly activationMode?: ActivationMode;
  readonly onSaveActivation?: (options: readonly ActivationOption[]) => void;
  readonly onCancelActivation?: () => void;
  /** selecting 阶段统一候选。 */
  readonly modelOptions?: readonly ModelOption[];
  /** selecting 阶段已选项下标（受控于调用方时传入）。 */
  readonly selectedModelIndex?: number;
  /** terminal 结果一次性展示。 */
  readonly lastResult?: PhaseResult | null;
  readonly onSelectModel?: (option: ModelOption) => void;
  readonly onCancelSelecting?: () => void;
  /** /model 统一模型选择器入口（提供时优先于旧 picker 屏）。 */
  readonly onRequestModelSelector?: () => void;
  /** /activate 激活管理页入口。 */
  readonly onRequestActivationManager?: () => void;
  /** 当前决策模式：local / manual / jev。 */
  readonly routingMode?: RoutingMode;
  readonly onModeChange?: (mode: RoutingMode) => void;
  /** 最喜欢的初始化 agent（来自 SQLite）。 */
  readonly favoriteAgent?: CliId | null;
  readonly onSetFavoriteAgent?: (agentId: CliId) => void;
  readonly onClearFavoriteAgent?: () => void;
  /** 当前工作区路径（默认 process.cwd()）。 */
  readonly workspace?: string;
  readonly onWorkspaceChange?: (newCwd: string) => void | Promise<void>;
  /** 历史工作区列表（来自 SQLite）。 */
  readonly recentWorkspaces?: readonly string[];
  readonly onGetRecentWorkspaces?: () => readonly string[];
}

type Screen = "scanning" | "activating" | "mode" | "picker" | "chat" | "detail";

/** 模型选择器分两步：先定 CLI，再看该 CLI 自己的模型。 */
type ModelPickStep = "cli" | "model";

function selectedIndexFor(clis: readonly DetectedCli[], initialId?: CliId): number {
  if (!initialId) {
    return 0;
  }

  const index = clis.findIndex((cli) => cli.id === initialId);
  return index >= 0 ? index : 0;
}

export const MODE_OPTIONS: readonly {
  readonly id: RoutingMode;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    id: "manual",
    label: "手动选择",
    description: "自己挑用哪个 CLI 干活",
  },
  {
    id: "local",
    label: "自动路由",
    description: "根据任务并结合本机 CLI 自动选择合适的 CLI",
  },
  {
    id: "jev",
    label: "Jev 决策",
    description: "调用 TypeSafe Jev 模型做第三方决策，不走自动推断",
  },
];

function moveSelection(
  current: number,
  delta: number,
  length: number,
): number {
  if (length === 0) {
    return 0;
  }

  return (current + delta + length) % length;
}

function probeStatusText(probe: ProbeDisplay): string {
  switch (probe.status) {
    case "scanning":
      return "扫描中";
    case "found":
      return `已找到 ${probe.models.length} 个模型`;
    case "unprobed":
      return `无法探测${probe.reason ? `：${probe.reason}` : ""}`;
    case "not-installed":
      return "未安装";
    case "disabled":
      return `已禁用${probe.reason ? `：${probe.reason}` : ""}`;
  }
}

/**
 * The CLI step only stops on CLIs whose adapter actually reported models.
 * Installed-but-unprobed and disabled CLIs are still listed for context, but
 * entering them could never offer a model to pick.
 */
function isPickable(
  cli: DetectedCli,
  probe: ProbeDisplay | undefined,
): boolean {
  return probe ? probe.status === "found" : cli.available;
}

function capabilityTags(option: ModelOption): string {
  const tags: string[] = [];
  if (option.capabilities.structuredEvents) {
    tags.push("结构化");
  }
  if (option.capabilities.nativeResume) {
    tags.push("原生会话");
  }
  if (option.capabilities.toolEvents) {
    tags.push("工具事件");
  }
  return tags.length > 0 ? ` [${tags.join("|")}]` : "";
}

/**
 * 「这个 CLI 还没就位」的说明：说清扫描过哪里、怎么装、以及是否需要重开终端。
 * 安装命令只打印不执行——复制粘贴由用户自己决定。
 */
function missingDetailLines(cli: DetectedCli): readonly string[] {
  const platform = installPlatformFor(process.platform);
  return [
    `当前环境未发现 ${cli.bin}。`,
    ...cliDiagnostics(cli).map((diagnostic) => diagnostic.message),
    "安装方式（复制后自行执行，coderelay 不会代跑）：",
    ...installHintLines(cli.id, platform).map((line) => `  ${line}`),
    "装好后重新打开终端，再运行 coderelay。",
  ];
}

export function App({
  clis,
  isScanning = false,
  initialId,
  turns = [],
  running = null,
  onLaunch,
  onAbort,
  onNewSession,
  onExit,
  phase,
  probes,
  activationOptions,
  activationMode = "confirm",
  onSaveActivation,
  onCancelActivation,
  modelOptions,
  selectedModelIndex,
  lastResult,
  onSelectModel,
  onCancelSelecting,
  onRequestModelSelector,
  onRequestActivationManager,
  routingMode = "local",
  onModeChange,
  favoriteAgent,
  onSetFavoriteAgent,
  onClearFavoriteAgent,
  workspace,
  onWorkspaceChange,
  recentWorkspaces,
  onGetRecentWorkspaces,
}: AppProps) {
  const [activeMode, setActiveMode] = useState<RoutingMode>(routingMode);
  const [activeWorkspace, setActiveWorkspace] = useState<string>(() =>
    workspace ? resolve(workspace) : process.cwd(),
  );

  const getRecentList = (): readonly string[] => {
    return onGetRecentWorkspaces?.() ?? recentWorkspaces ?? [];
  };

  useEffect(() => {
    setActiveMode(routingMode);
  }, [routingMode]);

  useEffect(() => {
    if (workspace) {
      setActiveWorkspace(resolve(workspace));
    }
  }, [workspace]);

  const [screen, setScreen] = useState<Screen>(() => {
    if (isScanning) {
      return "scanning";
    }
    if (phase === "activating") {
      return "activating";
    }
    // 交互模式结束后重挂载：带着 initialId 直接回到对话区继续干活。
    return initialId ? "chat" : "mode";
  });
  const [selectedIndex, setSelectedIndex] = useState(() =>
    selectedIndexFor(clis, initialId),
  );
  const [modelCursor, setModelCursor] = useState(0);
  // 受控下标意味着调用方已经替用户定好了 CLI，直接落在模型步。
  const initialPickStep: ModelPickStep =
    selectedModelIndex !== undefined ? "model" : "cli";
  const [modelPickStep, setModelPickStep] = useState<ModelPickStep>(
    initialPickStep,
  );
  // 下标是模型数组的下标，不是 CLI 数组的下标——两者顺序无关，只能问模型自己。
  const [pickedCliId, setPickedCliId] = useState<CliId | undefined>(
    initialPickStep === "model"
      ? modelOptions?.[selectedModelIndex ?? 0]?.cliId
      : undefined,
  );
  const [activationDraft, setActivationDraft] = useState<
    readonly ActivationOption[] | undefined
  >(undefined);
  const [activationCursor, setActivationCursor] = useState(0);
  const effectivePhase: AgentPhase =
    phase ?? (running ? "running" : "idle");

  // 受控下标（调用方传入时同步），并钳制到候选范围内。
  useEffect(() => {
    if (selectedModelIndex !== undefined) {
      setModelCursor(selectedModelIndex);
    }
  }, [selectedModelIndex]);

  const modelPickOptions = modelOptions ?? [];
  const optionCount = modelPickOptions.length;
  const clampedCursor =
    optionCount === 0
      ? 0
      : Math.min(Math.max(modelCursor, 0), optionCount - 1);

  // 选择器第一步只列 CLI：显式选中的那个，否则跟随当前活跃 CLI。
  const pickCliIndex =
    pickedCliId !== undefined
      ? clis.findIndex((cli) => cli.id === pickedCliId)
      : selectedIndex;
  const pickProbe = probes?.find((probe) => probe.cliId === pickedCliId);
  // 第一步只停在被探测到的 CLI 上；已安装但探测失败、以及已禁用的 CLI 都进不去。
  const pickableIndices = clis
    .map((cli, index) =>
      isPickable(cli, probes?.find((probe) => probe.cliId === cli.id))
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  // 第二步只列当前 CLI 自己的模型：config 不能把别的 CLI 的模型注进来。
  const cliModelOptions = pickedCliId
    ? modelPickOptions.filter((option) => option.cliId === pickedCliId)
    : [];

  const activationRows = activationDraft ?? activationOptions ?? [];
  const activationActive = effectivePhase === "activating" && activationRows.length > 0;

  const [modeIndex, setModeIndex] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // 备用屏里没有终端滚动条，根节点占满窗口，画面才会像全屏应用而不是命令输出。
  const { rows } = useWindowSize();

  useEffect(() => {
    if (isScanning) {
      setScreen("scanning");
      return;
    }

    // 扫描完成后：有未决 CLI 就落到激活页，否则回原有模式页。
    setScreen((current) => {
      if (current === "scanning") {
        return phase === "activating" ? "activating" : "mode";
      }
      // 激活流程结束（保存或 Esc 取消）后必须离开激活屏，否则没有任何
      // useInput 处于激活状态，界面会卡死。回到进来的地方：/activate 从
      // 对话区进，首次确认从首屏进。
      if (current === "activating" && phase !== "activating") {
        return initialId ? "chat" : "mode";
      }
      return current;
    });
  }, [isScanning, phase, initialId]);

  // 调用方切换进入激活流程（首次确认或 /activate）时，重建草稿并把光标落到首个可切换行。
  useEffect(() => {
    if (effectivePhase !== "activating" || !activationOptions) {
      return;
    }
    setActivationDraft(activationOptions);
    setActivationCursor(
      activationOptions.findIndex((option) => option.available),
    );
  }, [effectivePhase, activationOptions]);

  // 每次进入选择态都把两步选择器复位：调用方给了受控下标就直落模型步，
  // 否则从 CLI 步开始，保证下次 /model 不会沿用上一次的 CLI。
  useEffect(() => {
    if (effectivePhase !== "selecting") {
      return;
    }
    if (selectedModelIndex !== undefined) {
      setModelPickStep("model");
      setPickedCliId(modelOptions?.[selectedModelIndex]?.cliId);
      return;
    }
    setModelPickStep("cli");
    // 光标初始落在第一个可进入的 CLI 上：进不去的行不该抢到焦点。
    const firstPickable = clis.find((cli) =>
      isPickable(cli, probes?.find((probe) => probe.cliId === cli.id)),
    );
    setPickedCliId(firstPickable?.id);
  }, [effectivePhase, selectedModelIndex, modelOptions, clis, probes]);
  const selectedCli = clis[selectedIndex];
  const activeId = selectedCli?.id;

  useInput(
    (input, key) => {
      // 首屏没有上一层，所以 Esc 在这里不做事；退出统一收敛到 ctrl+c。
      if (key.ctrl && input === "c") {
        onExit();
        return;
      }

      if (key.leftArrow || input === "h") {
        setModeIndex((current) => moveSelection(current, -1, MODE_OPTIONS.length));
        return;
      }

      if (key.rightArrow || input === "l") {
        setModeIndex((current) => moveSelection(current, 1, MODE_OPTIONS.length));
        return;
      }

      if (!key.return) {
        return;
      }

      const selectedOption = MODE_OPTIONS[modeIndex];
      if (selectedOption) {
        setActiveMode(selectedOption.id);
        onModeChange?.(selectedOption.id);
      }

      if (selectedOption?.id === "manual") {
        setScreen("picker");
        return;
      }

      // 本地推断 / Jev 决策：直接进入对话
      const autoIndex = clis.findIndex((cli) => cli.available);
      if (autoIndex >= 0) {
        setSelectedIndex(autoIndex);
        const target = clis[autoIndex];
        setScreen(target && target.available ? "chat" : "detail");
      } else {
        setScreen("picker");
      }
    },
    { isActive: screen === "mode" },
  );

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        onExit();
        return;
      }

      if (key.escape) {
        // Esc 是返回键：CLI 列表的上一层是模式选择。
        setScreen("mode");
        return;
      }

      if (key.leftArrow || input === "h") {
        setSelectedIndex((current) =>
          moveSelection(current, -1, clis.length),
        );
        return;
      }

      if (key.rightArrow || input === "l") {
        setSelectedIndex((current) =>
          moveSelection(current, 1, clis.length),
        );
        return;
      }

      if (!key.return || !selectedCli) {
        return;
      }

      setScreen(selectedCli.available ? "chat" : "detail");
    },
    { isActive: screen === "picker" },
  );

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        // probing 取消当前操作；selecting 由选择器专属 useInput 处理取消，
        // 避免两个 hook 重复触发；starting/running 终止进程组；空闲退出。
        // phase 缺省时沿用旧语义：running 非空视为执行中（兼容旧调用）。
        if (effectivePhase === "probing") {
          onCancelSelecting?.();
        } else if (effectivePhase === "selecting") {
          return;
        } else if (effectivePhase === "activating") {
          return;
        } else if (
          effectivePhase === "starting" ||
          effectivePhase === "running" ||
          running
        ) {
          onAbort?.();
        } else {
          onExit();
        }
        return;
      }

      if (key.escape) {
        // Esc 是返回键，返回动作随相位变化：激活/模型选择各有专属 useInput
        // 处理取消，这里让位避免两个 hook 重复触发；探测中取消探测；
        // 执行中中止任务回到输入态；空闲时退回 CLI 列表。
        if (
          activationActive ||
          effectivePhase === "activating" ||
          effectivePhase === "selecting"
        ) {
          return;
        }
        if (effectivePhase === "probing") {
          onCancelSelecting?.();
          return;
        }
        if (
          running ||
          effectivePhase === "starting" ||
          effectivePhase === "running"
        ) {
          onAbort?.();
          return;
        }
        setScreen("picker");
        return;
      }

      if (
        running ||
        effectivePhase === "starting" ||
        effectivePhase === "running" ||
        effectivePhase === "probing" ||
        effectivePhase === "selecting" ||
        activationActive
      ) {
        // 任务执行/探测/选择/激活中不响应导航，避免开出新任务。
        return;
      }

      if (key.tab && activeId) {
        onLaunch({ id: activeId, mode: "interactive" });
      }
    },
    { isActive: screen === "chat" },
  );

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        onCancelActivation?.();
        return;
      }

      if (key.escape) {
        onCancelActivation?.();
        return;
      }

      if (key.upArrow || input === "k") {
        setActivationCursor((current) =>
          moveActivationCursor(activationRows, current, -1),
        );
        return;
      }

      if (key.downArrow || input === "j") {
        setActivationCursor((current) =>
          moveActivationCursor(activationRows, current, 1),
        );
        return;
      }

      if (input === " " || key.tab) {
        // 未安装的 CLI 不能激活：切换它只会写下一个执行时必然失败的状态。
        if (!isActivationSelectable(activationRows, activationCursor)) {
          return;
        }
        setActivationDraft((current) =>
          (current ?? activationRows).map((option, index) =>
            index === activationCursor
              ? { ...option, enabled: !option.enabled }
              : option,
          ),
        );
        return;
      }

      if (key.return) {
        onSaveActivation?.(activationRows);
      }
    },
    { isActive: activationActive },
  );

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        onCancelSelecting?.();
        return;
      }

      if (key.escape) {
        // 第二步退回第一步；第一步才真正取消整个选择。
        if (modelPickStep === "model") {
          setModelPickStep("cli");
          return;
        }
        onCancelSelecting?.();
        return;
      }

      if (modelPickStep === "cli") {
        if (key.upArrow || input === "k" || key.downArrow || input === "j") {
          const delta = key.upArrow || input === "k" ? -1 : 1;
          if (pickableIndices.length === 0) {
            return;
          }
          const current = Math.max(pickableIndices.indexOf(pickCliIndex), 0);
          const next =
            (current + delta + pickableIndices.length) % pickableIndices.length;
          const target = clis[pickableIndices[next] ?? 0];
          if (target) {
            // 只是浏览：不改变当前活跃 CLI，选定发生在下一步。
            setPickedCliId(target.id);
          }
          return;
        }

        if (key.return) {
          const target = clis[pickCliIndex];
          if (target && pickableIndices.includes(pickCliIndex)) {
            setPickedCliId(target.id);
            setModelPickStep("model");
            setModelCursor(0);
          }
          return;
        }
        return;
      }

      if (cliModelOptions.length === 0) {
        return;
      }

      if (key.upArrow || input === "k") {
        setModelCursor(
          (current) =>
            (current - 1 + cliModelOptions.length) % cliModelOptions.length,
        );
        return;
      }

      if (key.downArrow || input === "j") {
        setModelCursor((current) => (current + 1) % cliModelOptions.length);
        return;
      }

      if (key.return) {
        const option = cliModelOptions[clampedCursor];
        // 不可用候选不可提交：停留在选择器由用户另选。
        if (option?.available) {
          onSelectModel?.(option);
        }
      }
    },
    { isActive: effectivePhase === "selecting" && activationRows.length === 0 },
  );

  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        onExit();
        return;
      }

      if (key.return || key.escape) {
        setScreen("picker");
      }
    },
    { isActive: screen === "detail" },
  );

  // TextInput 的 onChange 走内部 effect 上报，回调身份参与依赖：
  // 必须保持稳定引用，否则每次重渲染都会把上一笔输入重复上报一次，
  // 迟到的 onChange 会带着 setNotice(null) 抹掉刚设置的提示。
  const handlePromptChange = useCallback((value: string): void => {
    setPrompt(value);
    setNotice(null);
  }, []);

  const handleSubmit = (value: string): void => {
    const normalized = value.trim();
    setPrompt("");
    setNotice(null);

    if (!normalized) {
      return;
    }

    if (normalized.startsWith("/")) {
      const matches = matchSlashCommands(normalized);
      if (matches.length === 1) {
        const command = matches[0];
        if (command?.name === "/mode") {
          const parts = normalized.split(/\s+/);
          const arg = parts[1]?.toLowerCase();
          let nextMode: RoutingMode;
          if (arg === "local" || arg === "manual" || arg === "jev") {
            nextMode = arg;
          } else {
            const sequence: RoutingMode[] = ["local", "manual", "jev"];
            const currentIdx = sequence.indexOf(activeMode);
            nextMode = sequence[(currentIdx + 1) % sequence.length] ?? "local";
          }
          setActiveMode(nextMode);
          onModeChange?.(nextMode);

          const modeLabels: Record<RoutingMode, string> = {
            local: "本地推断 (内置规则与打分，0ms 离线)",
            manual: "手动选择 (每次任务由用户挑选目标)",
            jev: "Jev 模型决策 (TypeSafe Jev System One 第三方决策层)",
          };
          setNotice(`✓ 决策模式已切换为：${modeLabels[nextMode]}`);
        } else if (command?.name === "/favorite") {
          const parts = normalized.split(/\s+/);
          const arg = parts[1]?.toLowerCase();
          if (!arg) {
            if (favoriteAgent) {
              setNotice(
                `当前最喜欢的初始化 agent 是: ${cliDisplayName(favoriteAgent)} (${favoriteAgent}) · 输入 /favorite <codex|claude|pi|omp> 进行修改`,
              );
            } else {
              setNotice(
                "尚未设置最喜欢的初始化 agent · 输入 /favorite <codex|claude|pi|omp> 进行设置",
              );
            }
            return;
          }
          if (arg === "clear" || arg === "none") {
            onClearFavoriteAgent?.();
            setNotice("✓ 已清除最喜欢的初始化 agent 偏好设置");
            return;
          }
          if (isAgentId(arg)) {
            onSetFavoriteAgent?.(arg);
            setNotice(
              `✓ 已将 ${cliDisplayName(arg)} (${arg}) 设为最喜欢的初始化 agent (已保存至 SQLite)`,
            );
          } else {
            setNotice(`未知 agent: "${arg}"，可选: ${CLI_IDS.join(", ")}`);
          }
        } else if (command?.name === "/workspace" || command?.name === "/cd") {
          const parts = normalized.split(/\s+/);
          let rawTarget = parts.slice(1).join(" ").trim();
          const recents = getRecentList();

          if (!rawTarget) {
            if (recents.length > 0) {
              const listText = recents
                .map((ws, i) => `  [${i + 1}] ${ws}`)
                .join("\n");
              setNotice(
                `当前工作区：${activeWorkspace}\n最近工作区：\n${listText}\n输入 /workspace <序号或路径> 切换`,
              );
            } else {
              setNotice(`当前工作区：${activeWorkspace}`);
            }
            return;
          }

          // 支持按最近工作区序号切换（如 /workspace 1）
          const indexNum = Number(rawTarget);
          if (
            Number.isInteger(indexNum) &&
            indexNum >= 1 &&
            indexNum <= recents.length
          ) {
            const targetFromIndex = recents[indexNum - 1];
            if (targetFromIndex) {
              try {
                const stat = statSync(targetFromIndex);
                if (stat.isDirectory()) {
                  setActiveWorkspace(targetFromIndex);
                  void onWorkspaceChange?.(targetFromIndex);
                  setNotice(`✓ 工作区已切换为: ${targetFromIndex}`);
                  return;
                }
              } catch {
                setNotice(`目录不存在: ${targetFromIndex}`);
                return;
              }
            }
          }

          if (
            (rawTarget.startsWith('"') && rawTarget.endsWith('"')) ||
            (rawTarget.startsWith("'") && rawTarget.endsWith("'"))
          ) {
            rawTarget = rawTarget.slice(1, -1);
          }
          const expanded = rawTarget.startsWith("~")
            ? rawTarget.replace(/^~(?=$|\/|\\)/, homedir())
            : rawTarget;
          const resolvedPath = resolve(activeWorkspace, expanded);
          try {
            const stat = statSync(resolvedPath);
            if (!stat.isDirectory()) {
              setNotice(`路径不是目录: ${resolvedPath}`);
              return;
            }
          } catch {
            setNotice(`目录不存在: ${resolvedPath}`);
            return;
          }
          setActiveWorkspace(resolvedPath);
          void onWorkspaceChange?.(resolvedPath);
          setNotice(`✓ 工作区已切换为: ${resolvedPath}`);
        } else if (command?.name === "/model") {
          if (onRequestModelSelector) {
            setModelPickStep("cli");
            setPickedCliId(undefined);
            onRequestModelSelector();
          } else {
            setScreen("picker");
          }
        } else if (command?.name === "/activate") {
          onRequestActivationManager?.();
        } else if (command?.name === "/new") {
          onNewSession?.();
        } else if (command?.name === "/help") {
          setNotice(SLASH_HELP);
        }
      } else if (matches.length === 0) {
        setNotice("未知命令，输入 / 查看可用命令");
      } else {
        setNotice("命令不唯一，再输入几个字母");
      }
      return;
    }

    if (!running && activeId) {
      onLaunch({ id: activeId, mode: "prompt", prompt: normalized });
    }
  };

  const slashCommands = useMemo(() => {
    const trimmed = prompt.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0]?.toLowerCase() ?? "";
    const arg = parts.slice(1).join(" ").trim();
    if (
      (cmd === "/workspace" || cmd === "/cd") &&
      (prompt.includes(" ") || arg)
    ) {
      const recents = getRecentList();
      if (recents.length > 0) {
        return recents
          .map((ws, i) => ({ index: i + 1, path: ws }))
          .filter(
            ({ index, path }) =>
              !arg ||
              String(index).startsWith(arg) ||
              path.toLowerCase().includes(arg.toLowerCase()),
          )
          .slice(0, 5)
          .map(({ index, path }) => ({
            name: `${cmd} ${index}`,
            description: path,
          }));
      }
    }
    return matchSlashCommands(prompt);
  }, [prompt, recentWorkspaces, onGetRecentWorkspaces]);

  const stage: Stage =
    screen === "scanning"
      ? "scan"
      : screen === "chat"
        ? running
          ? "run"
          : turns.length > 0
            ? "result"
            : "compose"
        : "select";
  const focusId = screen === "chat" && running ? running.id : activeId;

  let hint: HintContext = "picker";
  let body: ReactNode;

  const autoCli = clis.find((cli) => cli.available);

  if (screen === "scanning") {
    hint = "scanning";
    body = <ScanningView />;
  } else if (activationActive) {
    hint = "activating";
    body = (
      <Box flexDirection="column">
        <ActivationView
          mode={activationMode}
          options={activationRows}
          cursor={activationCursor}
        />
        {/* 写盘失败时留在本页，所以错误必须在这里可见，而不是回到对话区才看得到。 */}
        {lastResult?.phase === "failed" ? (
          <Box paddingX={2}>
            <Text color={theme.alert}>{lastResult.message}</Text>
          </Box>
        ) : null}
      </Box>
    );
  } else if (screen === "mode") {
    hint = "mode";
    body = (
      <Box flexDirection="column" paddingX={2}>
        <Box marginBottom={1}>
          <Text bold color={theme.text}>
            先选个开场方式？
          </Text>
        </Box>
        <Box flexDirection="row">
          {MODE_OPTIONS.map((option, index) => {
            const active = index === modeIndex;
            const underlineWidth = option.label.length;
            return (
              <Box
                key={option.id}
                flexDirection="column"
                marginRight={index < MODE_OPTIONS.length - 1 ? 3 : 0}
              >
                <Text bold={active} color={active ? theme.text : theme.muted}>
                  {option.label}
                </Text>
                <Text color={theme.accent}>
                  {active
                    ? "─".repeat(underlineWidth)
                    : " ".repeat(underlineWidth)}
                </Text>
              </Box>
            );
          })}
        </Box>
        <Box marginTop={1} height={1}>
          <Text color={theme.muted} wrap="truncate-end">
            {modeIndex === 1
              ? autoCli
                ? "根据任务并结合本机 CLI 自动选择合适的 CLI"
                : "暂无可用 CLI，先手动看看"
              : MODE_OPTIONS[modeIndex]?.description}
          </Text>
        </Box>
      </Box>
    );
  } else if (effectivePhase === "selecting" && modelOptions) {
    hint = "chat";
    body =
      modelPickStep === "cli" ? (
        <Box flexDirection="column" paddingX={2}>
          <Text bold color={theme.text}>
            选择 CLI（↑↓ 移动，Enter 进入，Esc 取消）
          </Text>
          {clis.map((cli, index) => {
            const probe = probes?.find((item) => item.cliId === cli.id);
            const pickable = isPickable(cli, probe);
            const focused = index === pickCliIndex && pickable;
            const state = probe
              ? probeStatusText(probe)
              : cli.available
                ? "已找到"
                : "未安装";
            return (
              <Text key={cli.id}>
                <Text color={theme.accent}>{focused ? "❯ " : "  "}</Text>
                <Text
                  bold={focused}
                  color={pickable ? theme.text : theme.muted}
                >
                  {cliDisplayName(cli.id)}
                </Text>
                <Text color={theme.muted}>{`  ${state}`}</Text>
              </Text>
            );
          })}
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={2}>
          <Text bold color={theme.text}>
            选择模型 ·{" "}
            {pickedCliId ? cliDisplayName(pickedCliId) : ""}
            {pickProbe && pickProbe.status !== "found"
              ? `：${probeStatusText(pickProbe)}`
              : ""}
            （↑↓ 移动，Enter 确认，Esc 返回）
          </Text>
          {cliModelOptions.length === 0 ? (
            <Text color={theme.alert}>该 CLI 没有探测到可用模型。</Text>
          ) : null}
          {cliModelOptions.map((option, index) => {
            const cursor = index === clampedCursor;
            const state = option.available
              ? ""
              : `（不可用${option.reason ? `：${option.reason}` : ""}）`;
            return (
              <Text
                key={`${option.cliId}:${option.modelId}`}
                bold={cursor}
                color={
                  option.available
                    ? cursor
                      ? theme.text
                      : theme.muted
                    : theme.muted
                }
              >
                {cursor ? "❯" : " "} {option.modelId} {option.label}
                {option.isDefault || option.isNativeDefault ? " [默认]" : ""}
                {capabilityTags(option)}
                {state}
              </Text>
            );
          })}
        </Box>
      );
  } else if (screen === "chat" && activeId) {
    hint = running ? "running" : "chat";
    const phaseBanner: ReactNode =
      effectivePhase === "probing" && probes ? (
        <Box flexDirection="column" paddingX={2} marginBottom={1}>
          <Text bold color={theme.text}>
            正在探测本机模型…
          </Text>
          {probes.map((probe) => (
            <Text key={probe.cliId} color={theme.muted}>
              {cliDisplayName(probe.cliId)}：{probeStatusText(probe)}
            </Text>
          ))}
        </Box>
      ) : effectivePhase === "starting" && running ? (
        <Box paddingX={2} marginBottom={1}>
          <Text bold color={theme.text}>
            正在启动 {cliDisplayName(running.id)}
            {running.modelId ? `:${running.modelId}` : ""}…
          </Text>
        </Box>
      ) : lastResult ? (
        <Box paddingX={2} marginBottom={1}>
          <Text
            color={
              lastResult.phase === "completed"
                ? theme.ok
                : lastResult.phase === "aborted"
                  ? theme.muted
                  : theme.alert
            }
          >
            {lastResult.message}
          </Text>
        </Box>
      ) : null;
    body = (
      <Box flexDirection="column">
        {phaseBanner}
        <ChatView
        agentName={cliDisplayName(activeId)}
        turns={turns}
        running={
          running
            ? {
                agentName: cliDisplayName(running.id),
                prompt: running.prompt,
                startedAt: running.startedAt,
                modelId: running.modelId,
                liveText: running.liveText,
                statusText: running.statusText,
                tool: running.tool,
              }
            : null
        }
        prompt={prompt}
        notice={notice}
        commands={slashCommands}
        onChange={handlePromptChange}
        onSubmit={handleSubmit}
        />
      </Box>
    );
  } else if (screen === "detail" && selectedCli) {
    hint = "detail";
    body = (
      <Box flexDirection="column" paddingX={2}>
        <Text bold color={theme.text}>
          {cliDisplayName(selectedCli.id)} 还没就位
        </Text>
        {missingDetailLines(selectedCli).map((line, index) => (
          <Text key={index} color={theme.muted} wrap="truncate-end">
            {line}
          </Text>
        ))}
      </Box>
    );
  } else {
    body = <CliList clis={clis} selectedIndex={selectedIndex} />;
  }

  return (
    <InkThemeProvider theme={inkTheme}>
      {/* 不铺底色：底色交给终端原生背景。Ink 只给有字符的格子刷底，
          整屏铺 backgroundColor 会在空行和行尾漏出终端底色。 */}
      <Box width="100%" minHeight={rows} flexDirection="column">
        <AppHeader mode={activeMode} />
        <StageBar
          stage={stage}
          focus={focusId ? cliDisplayName(focusId) : undefined}
          focusNote={screen === "detail" ? "未安装" : undefined}
        />
        <Box flexDirection="column" marginTop={1}>{body}</Box>
        {/* 弹簧把键位条顶到窗口最后一行，画面因此始终铺满整屏。 */}
        <Box flexGrow={1} />
        <Box paddingX={2} marginTop={1}>
          <HintBar context={hint} />
        </Box>
      </Box>
    </InkThemeProvider>
  );
}
