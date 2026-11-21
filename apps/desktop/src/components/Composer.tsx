import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

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
  RouteIcon,
  ShieldIcon,
  StopIcon,
  TerminalIcon,
} from "./icons";

export interface ComposerProps {
  compact?: boolean;
  prompt: string;
  onPromptChange: (value: string) => void;
  running: boolean;
  onStartRun: () => void;
  onCancelRun: () => void;
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
  "grid h-[26px] w-[26px] place-items-center rounded-lg transition-all duration-140 enabled:cursor-pointer enabled:hover:bg-surface-subtle enabled:hover:text-ink disabled:opacity-30";

type ActiveMenu = "mode" | "cli" | "model" | "permission" | null;

interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  dangerous?: boolean;
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
  menuTitle?: string;
  leadingIcon?: ReactNode;
  align?: "left" | "right";
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
  menuTitle,
  leadingIcon,
  align = "right",
  maxLabelWidth = "max-w-[100px]",
  minDropdownWidth = "min-w-[140px]",
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
        className={`group relative inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium tracking-[-0.01em] transition-all duration-140 select-none ${
          open
            ? isDangerous
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "bg-surface-subtle text-ink"
            : isDangerous
              ? "bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
              : "bg-transparent text-muted-strong hover:bg-surface-subtle hover:text-ink"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      >
        {leadingIcon ? (
          <span className="flex shrink-0 items-center justify-center">
            {leadingIcon}
          </span>
        ) : null}
        <span className={`truncate ${maxLabelWidth}`}>{label}</span>
        <span
          className={`transition-transform duration-150 ${
            open
              ? "rotate-180 text-ink"
              : "text-muted/45 group-hover:text-muted-strong"
          }`}
        >
          <ChevronDownIcon size={9} />
        </span>
      </button>

      <AnimatePresence>
        {open && !disabled ? (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, scale: 0.97, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.13, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute bottom-[calc(100%+6px)] z-50 flex max-h-[280px] flex-col overflow-hidden rounded-xl border border-line-strong bg-surface/96 p-1 shadow-[0_14px_36px_-6px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl ${
              align === "left" ? "left-0" : "right-0"
            } ${minDropdownWidth}`}
          >
            {menuTitle ? (
              <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-medium tracking-wider text-muted/70 uppercase select-none">
                {menuTitle}
              </div>
            ) : null}
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
                    className={`flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors duration-100 ${
                      isSelected
                        ? "bg-surface-hover/80 font-medium text-ink"
                        : "text-ink-soft hover:bg-surface-subtle hover:text-ink"
                    }`}
                  >
                    <span className="mt-[2px] flex h-3.5 w-3.5 shrink-0 items-center justify-center text-ink">
                      {isSelected ? <CheckIcon size={11} /> : null}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className={`truncate ${
                          opt.dangerous
                            ? "text-amber-700 dark:text-amber-300"
                            : ""
                        }`}
                      >
                        {opt.label}
                      </span>
                      {opt.description ? (
                        <span className="text-[11px] leading-snug font-normal text-muted">
                          {opt.description}
                        </span>
                      ) : null}
                    </span>
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
    label: item.label,
    description: item.description,
    dangerous: Boolean(item.dangerous),
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

      <div
        ref={containerRef}
        className="flex flex-wrap items-center justify-between gap-2 px-3 pt-1 pb-2.5"
      >
        {/* 左侧：路由模式 + 路由预览 */}
        <div className="flex items-center gap-0.5">
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
            menuTitle="路由模式"
            align="left"
            leadingIcon={
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  activeMode === "local"
                    ? "bg-emerald-500/85"
                    : "bg-muted-strong/60"
                }`}
              />
            }
            maxLabelWidth="max-w-[85px]"
            minDropdownWidth="min-w-[132px]"
          />

          <span
            aria-hidden="true"
            className="mx-0.5 h-3 w-px bg-line-strong/60"
          />

          <button
            aria-label="Route preview"
            className={`${ACTION_BTN_BASE} bg-transparent text-muted/75`}
            disabled={!hasPrompt}
            type="button"
            onClick={onPreviewRoute}
            title="Route preview"
          >
            <RouteIcon size={14} />
          </button>
        </div>

        {/* 右侧：执行引擎 (CLI / 模型) + 权限 + 发送 */}
        <div className="flex flex-wrap items-center justify-end gap-0.5">
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
            menuTitle="执行 CLI"
            leadingIcon={
              <TerminalIcon
                size={12}
                className="text-muted/70 transition-colors group-hover:text-muted-strong"
              />
            }
            maxLabelWidth="max-w-[95px]"
            minDropdownWidth="min-w-[144px]"
          />

          <span
            aria-hidden="true"
            className="select-none text-[11px] text-muted/40"
          >
            /
          </span>

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
            menuTitle="模型"
            maxLabelWidth="max-w-[145px]"
            minDropdownWidth="min-w-[190px]"
          />

          {currentPermission && permissionChoices.length > 1 ? (
            <>
              <span
                aria-hidden="true"
                className="mx-1 h-3 w-px bg-line-strong/60"
              />
              <CustomSelectPill
                label={currentPermission.label}
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
                menuTitle="权限等级"
                leadingIcon={
                  <ShieldIcon
                    size={12}
                    className={
                      currentPermission.dangerous
                        ? "text-amber-600 dark:text-amber-300"
                        : "text-muted/70 transition-colors group-hover:text-muted-strong"
                    }
                  />
                }
                maxLabelWidth="max-w-[100px]"
                minDropdownWidth="min-w-[210px]"
                isDangerous={Boolean(currentPermission.dangerous)}
              />
            </>
          ) : null}

          {running ? (
            <motion.button
              aria-label="Stop"
              className="ml-1.5 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-canvas shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-all duration-140 hover:opacity-85"
              onClick={onCancelRun}
              title="Stop"
              type="button"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.94 }}
            >
              <StopIcon size={10} />
            </motion.button>
          ) : (
            <motion.button
              aria-label="Run"
              className={`ml-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-full transition-all duration-140 ${
                hasPrompt
                  ? "cursor-pointer bg-ink text-canvas shadow-[0_1px_3px_rgba(0,0,0,0.14)] enabled:hover:opacity-90"
                  : "bg-surface-subtle/80 text-muted/45"
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
