import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { AgentEntry, AgentPermissions, ModelOption } from "../types";
import {
  formatModeLabel,
  getAvailableModelsForCli,
  resolveRouteSelection,
} from "../utils";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  RouteIcon,
  StopIcon,
} from "./icons";

export interface ComposerProps {
  compact?: boolean;
  prompt: string;
  onPromptChange: (value: string) => void;
  running: boolean;
  onStartRun: () => void;
  onCancelRun: () => void;
  workspaceInput: string;
  onPickWorkspace: () => void;
  mode: string;
  routingModes: string[];
  onModeChange: (mode: string) => void;
  onPreviewRoute: () => void;
  agent: string;
  model: string;
  onAgentModelChange: (agent: string, model: string) => void;
  agents: AgentEntry[];
  catalogOptions: ModelOption[];
  permission: string;
  permissions: AgentPermissions[];
  onPermissionChange: (permission: string) => void;
  selectedAgentLabel?: string;
}

const ACTION_BTN_BASE =
  "grid h-7 w-7 place-items-center rounded-md transition-all duration-140 enabled:hover:bg-surface-subtle enabled:hover:text-ink disabled:opacity-30";

type ActiveMenu = "mode" | "cli" | "model" | "permission" | null;

interface DropdownOption {
  value: string;
  label: string;
}

interface CustomSelectPillProps {
  label: string;
  value: string;
  options: DropdownOption[];
  onSelect: (value: string) => void;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  title?: string;
  maxLabelWidth?: string;
  minDropdownWidth?: string;
  isDangerous?: boolean;
}

function CustomSelectPill({
  label,
  value,
  options,
  onSelect,
  open,
  onToggle,
  disabled = false,
  title,
  maxLabelWidth = "max-w-[100px]",
  minDropdownWidth = "min-w-[130px]",
  isDangerous = false,
}: CustomSelectPillProps) {
  return (
    <div className="relative inline-flex items-center" title={title}>
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`group relative inline-flex h-[26px] cursor-pointer items-center gap-1 rounded-md border px-2 text-xs font-medium transition-all duration-140 select-none ${
          open
            ? isDangerous
              ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              : "border-line-strong bg-surface-hover text-ink"
            : isDangerous
              ? "border-amber-500/30 bg-amber-500/5 text-amber-700 hover:border-amber-500/50 hover:bg-amber-500/10 dark:text-amber-300"
              : "border-line/70 bg-surface-subtle/50 text-muted-strong hover:border-line-strong hover:bg-surface-subtle hover:text-ink"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <span className={`truncate ${maxLabelWidth}`}>{label}</span>
        <span
          className={`transition-transform duration-150 ${
            open ? "rotate-180 text-ink" : "text-muted/60 group-hover:text-muted"
          }`}
        >
          <ChevronDownIcon size={10} />
        </span>
      </button>

      <AnimatePresence>
        {open && !disabled ? (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, scale: 0.96, y: 3 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 3 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute bottom-[calc(100%+5px)] right-0 z-50 flex max-h-[260px] flex-col overflow-hidden rounded-[11px] border border-line-strong bg-surface/98 p-1 shadow-[0_12px_32px_-4px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.04)] backdrop-blur-md ${minDropdownWidth}`}
          >
            <div className="flex-1 overflow-y-auto p-0.5 [scrollbar-color:rgba(0,0,0,0.12)_transparent] [scrollbar-width:thin]">
              {options.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onSelect(opt.value)}
                    className={`flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-left text-xs transition-colors duration-100 ${
                      isSelected
                        ? "bg-surface-hover font-medium text-ink"
                        : "text-ink-soft hover:bg-surface-subtle hover:text-ink"
                    }`}
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-ink">
                      {isSelected ? <CheckIcon size={11} /> : null}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function Composer({
  compact = false,
  prompt,
  onPromptChange,
  running,
  onStartRun,
  onCancelRun,
  workspaceInput,
  onPickWorkspace,
  mode,
  routingModes,
  onModeChange,
  onPreviewRoute,
  agent,
  model,
  onAgentModelChange,
  agents,
  catalogOptions,
  permission,
  permissions,
  onPermissionChange,
}: ComposerProps) {
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (running && activeMenu) {
      setActiveMenu(null);
    }
  }, [running, activeMenu]);

  useEffect(() => {
    if (!activeMenu) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && containerRef.current && !containerRef.current.contains(target)) {
        setActiveMenu(null);
      }
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveMenu(null);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [activeMenu]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (prompt.trim() && !running) {
        onStartRun();
      }
    }
  }

  const effectiveRoutingModes = routingModes.length > 0 ? routingModes : ["local"];
  const resolved = resolveRouteSelection(
    { mode, agent, model },
    effectiveRoutingModes,
    agents,
    catalogOptions,
  );

  const activeMode = resolved.mode;
  const activeAgent = resolved.agent;
  const activeModel = resolved.model;

  const currentAgentEntry = agents.find((ag) => ag.id === activeAgent) ?? agents[0];
  const currentAgentLabel = currentAgentEntry?.label ?? activeAgent;

  const availableModels = getAvailableModelsForCli(catalogOptions, activeAgent);
  const currentModelOption =
    availableModels.find((m) => m.modelId === activeModel) ?? availableModels[0];
  const currentModelLabel =
    currentModelOption?.label ||
    currentModelOption?.modelId ||
    activeModel ||
    currentAgentLabel ||
    "默认";

  function handleModeSelect(nextMode: string) {
    onModeChange(nextMode);
    setActiveMenu(null);
  }

  function handleCliChange(nextAgentId: string) {
    const nextModels = getAvailableModelsForCli(catalogOptions, nextAgentId);
    const nextModelId = nextModels[0]?.modelId ?? "";
    onAgentModelChange(nextAgentId, nextModelId);
    setActiveMenu(null);
  }

  function handleModelChange(nextModelId: string) {
    onAgentModelChange(activeAgent, nextModelId);
    setActiveMenu(null);
  }

  const permissionChoices =
    permissions.find((item) => item.cliId === activeAgent)?.options ?? [];
  const currentPermission =
    permissionChoices.find((item) => item.id === permission) ??
    permissionChoices[0];
  const permissionOptions: DropdownOption[] = permissionChoices.map((item) => ({
    value: item.id,
    label: item.dangerous ? `⚠ ${item.label}` : item.label,
  }));

  function handlePermissionChange(nextPermission: string) {
    onPermissionChange(nextPermission);
    setActiveMenu(null);
  }

  const modeOptions: DropdownOption[] = effectiveRoutingModes.map((m) => ({
    value: m,
    label: formatModeLabel(m),
  }));

  const cliOptions: DropdownOption[] = agents.map((ag) => ({
    value: ag.id,
    label: ag.label,
  }));

  const modelOptions: DropdownOption[] =
    availableModels.length > 0
      ? availableModels.map((m) => ({
          value: m.modelId,
          label: m.label || m.modelId,
        }))
      : [
          {
            value: "",
            label: currentAgentLabel || "默认",
          },
        ];

  const hasPrompt = Boolean(prompt.trim());

  return (
    <div
      className={`mx-auto w-[min(700px,100%)] border border-line-strong bg-surface transition-[border-color,box-shadow] duration-180 focus-within:border-line-strong focus-within:shadow-[0_16px_44px_-8px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.035)] ${
        compact
          ? "rounded-[18px] shadow-[0_6px_24px_-4px_rgba(0,0,0,0.05),0_1px_3px_rgba(0,0,0,0.02)]"
          : "rounded-[22px] shadow-[0_10px_36px_-8px_rgba(0,0,0,0.055),0_2px_6px_rgba(0,0,0,0.025)]"
      }`}
    >
      <textarea
        aria-label="Prompt"
        className={`block max-h-[200px] w-full resize-none border-0 bg-transparent leading-[1.65] text-ink placeholder:text-zinc-300 ${
          compact
            ? "min-h-[52px] px-4 pt-3.5 pb-1.5 text-sm"
            : "min-h-[76px] px-5 pt-[18px] pb-2 text-[15px]"
        }`}
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="›"
        disabled={running}
      />

      <div className="flex items-center justify-between gap-2 px-3.5 pt-1.5 pb-3">
        <div className="flex items-center gap-1.5">
          <button
            aria-label="选择文件夹"
            className={`${ACTION_BTN_BASE} bg-transparent text-muted`}
            type="button"
            onClick={onPickWorkspace}
            title={workspaceInput ? `选择文件夹（当前：${workspaceInput}）` : "选择文件夹"}
          >
            <FolderIcon size={14} />
          </button>
          <button
            aria-label="Route preview"
            className={`${ACTION_BTN_BASE} bg-transparent text-muted`}
            disabled={!hasPrompt}
            type="button"
            onClick={onPreviewRoute}
            title="Route preview"
          >
            <RouteIcon size={14} />
          </button>
        </div>

        <div ref={containerRef} className="flex items-center gap-1 flex-wrap justify-end">
          {/* 第一块：选模式 */}
          <CustomSelectPill
            label={formatModeLabel(activeMode)}
            value={activeMode}
            options={modeOptions}
            onSelect={handleModeSelect}
            open={activeMenu === "mode"}
            onToggle={() =>
              setActiveMenu((curr) => (curr === "mode" ? null : "mode"))
            }
            disabled={running}
            title={`模式: ${activeMode}`}
            maxLabelWidth="max-w-[75px]"
            minDropdownWidth="min-w-[110px]"
          />

          {/* 第二块：选 CLI */}
          <CustomSelectPill
            label={currentAgentLabel}
            value={activeAgent}
            options={cliOptions}
            onSelect={handleCliChange}
            open={activeMenu === "cli"}
            onToggle={() =>
              setActiveMenu((curr) => (curr === "cli" ? null : "cli"))
            }
            disabled={running}
            title={`CLI: ${currentAgentLabel}`}
            maxLabelWidth="max-w-[95px]"
            minDropdownWidth="min-w-[130px]"
          />

          {/* 第三块：选 agent / 模型 */}
          <CustomSelectPill
            label={currentModelLabel}
            value={activeModel}
            options={modelOptions}
            onSelect={handleModelChange}
            open={activeMenu === "model"}
            onToggle={() =>
              setActiveMenu((curr) => (curr === "model" ? null : "model"))
            }
            disabled={running}
            title={`模型: ${currentModelLabel}`}
            maxLabelWidth="max-w-[130px]"
            minDropdownWidth="min-w-[180px]"
          />

          {/* 第四块：选权限（仅当该 CLI 有多个权限档位） */}
          {currentPermission && permissionChoices.length > 1 ? (
            <CustomSelectPill
              label={
                currentPermission.dangerous
                  ? `⚠ ${currentPermission.label}`
                  : currentPermission.label
              }
              value={currentPermission.id}
              options={permissionOptions}
              onSelect={handlePermissionChange}
              open={activeMenu === "permission"}
              onToggle={() =>
                setActiveMenu((curr) =>
                  curr === "permission" ? null : "permission",
                )
              }
              disabled={running}
              title={`权限: ${currentPermission.label}（${currentPermission.description}）`}
              maxLabelWidth="max-w-[100px]"
              minDropdownWidth="min-w-[140px]"
              isDangerous={Boolean(currentPermission.dangerous)}
            />
          ) : null}

          {running ? (
            <motion.button
              aria-label="Stop"
              className="ml-0.5 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-canvas transition-all duration-140 hover:opacity-85"
              onClick={onCancelRun}
              title="Stop"
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
            >
              <StopIcon size={11} />
            </motion.button>
          ) : (
            <motion.button
              aria-label="Run"
              className={`ml-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full transition-all duration-140 ${
                hasPrompt
                  ? "cursor-pointer bg-ink text-canvas enabled:hover:opacity-85 disabled:bg-surface-subtle disabled:text-muted"
                  : "bg-surface-subtle text-muted"
              }`}
              disabled={!hasPrompt}
              onClick={onStartRun}
              title="Run"
              type="button"
              whileHover={hasPrompt ? { scale: 1.05 } : undefined}
              whileTap={hasPrompt ? { scale: 0.94 } : undefined}
            >
              <ArrowUpIcon size={14} />
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}
