import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useRef, useState } from "react";

import { useThemeStore } from "../stores/themeStore";
import { CloseIcon, PlusIcon, RefreshIcon, TerminalIcon } from "./icons";

interface TerminalCreateResponse {
  terminalId: string;
  shell: string;
  cwd: string;
}

interface TerminalOutputPayload {
  terminalId: string;
  data: string;
}

interface TerminalExitPayload {
  terminalId: string;
  code: number | null;
}

interface TerminalTab {
  id: string;
  title: string;
  cwd: string;
  exited: boolean;
  exitCode: number | null;
}

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  container: HTMLDivElement;
  dispose: () => void;
}

export interface TerminalPanelProps {
  active: boolean;
  workspaceCwd: string;
}

const LIGHT_XTERM_THEME: ITheme = {
  background: "#fafafa",
  foreground: "#18181b",
  cursor: "#18181b",
  cursorAccent: "#fafafa",
  selectionBackground: "rgba(24, 24, 27, 0.16)",
  black: "#18181b",
  red: "#dc2626",
  green: "#16805c",
  yellow: "#b45309",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#e4e4e7",
  brightBlack: "#71717a",
  brightRed: "#ef4444",
  brightGreen: "#10b981",
  brightYellow: "#d97706",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#fafafa",
};

const DARK_XTERM_THEME: ITheme = {
  background: "#1c1c1c",
  foreground: "#e4e4e7",
  cursor: "#f4f4f5",
  cursorAccent: "#1c1c1c",
  selectionBackground: "rgba(244, 244, 245, 0.22)",
  black: "#27272a",
  red: "#f87171",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e4e4e7",
  brightBlack: "#71717a",
  brightRed: "#fca5a5",
  brightGreen: "#6ee7b7",
  brightYellow: "#fcd34d",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#ffffff",
};

function shortShellName(shellPath: string): string {
  const parts = shellPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "shell";
}

export function TerminalPanel({ active, workspaceCwd }: TerminalPanelProps) {
  const colorScheme = useThemeStore((s) => s.colorScheme);
  const xtermTheme = colorScheme === "dark" ? DARK_XTERM_THEME : LIGHT_XTERM_THEME;

  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const instancesRef = useRef<Map<string, TerminalInstance>>(new Map());
  const xtermThemeRef = useRef<ITheme>(xtermTheme);
  const hasAutoStartedRef = useRef(false);
  xtermThemeRef.current = xtermTheme;

  const fitAndResizeTab = useCallback((tabId: string) => {
    const instance = instancesRef.current.get(tabId);
    if (!instance) {
      return;
    }
    const { container, fitAddon, terminal } = instance;
    if (container.clientWidth === 0 || container.clientHeight === 0) {
      return;
    }
    fitAddon.fit();
    void invoke("terminal_resize", {
      terminalId: tabId,
      cols: terminal.cols,
      rows: terminal.rows,
    }).catch(() => {
      // Ignore resize errors if the PTY has already exited.
    });
  }, []);

  const createTerminalTab = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    setCreating(true);
    setError(null);

    const container = document.createElement("div");
    container.className = "h-full w-full overflow-hidden";
    container.style.display = "none";
    stage.appendChild(container);

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        '"JetBrains Mono", "SFMono-Regular", "Cascadia Code", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: xtermThemeRef.current,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    const initialCols = Math.max(40, Math.floor((stage.clientWidth || 420) / 8));
    const initialRows = Math.max(12, Math.floor((stage.clientHeight || 480) / 18));

    try {
      const response = await invoke<TerminalCreateResponse>("terminal_create", {
        cwd: workspaceCwd.trim() || undefined,
        cols: initialCols,
        rows: initialRows,
      });

      const dataDisposable = terminal.onData((data) => {
        void invoke("terminal_write", {
          terminalId: response.terminalId,
          data,
        }).catch(() => {
          // Ignore writes after PTY exit.
        });
      });

      const resizeDisposable = terminal.onResize(({ cols, rows }) => {
        void invoke("terminal_resize", {
          terminalId: response.terminalId,
          cols,
          rows,
        }).catch(() => {
          // Ignore resize after PTY exit.
        });
      });

      const dispose = () => {
        dataDisposable.dispose();
        resizeDisposable.dispose();
        terminal.dispose();
        container.remove();
      };

      instancesRef.current.set(response.terminalId, {
        terminal,
        fitAddon,
        container,
        dispose,
      });

      setTabs((current) => [
        ...current,
        {
          id: response.terminalId,
          title: shortShellName(response.shell),
          cwd: response.cwd,
          exited: false,
          exitCode: null,
        },
      ]);
      setActiveTabId(response.terminalId);
    } catch (err) {
      terminal.dispose();
      container.remove();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [workspaceCwd]);

  const closeTerminalTab = useCallback((tabId: string) => {
    const instance = instancesRef.current.get(tabId);
    if (instance) {
      instance.dispose();
      instancesRef.current.delete(tabId);
    }
    void invoke("terminal_close", { terminalId: tabId }).catch(() => {
      // Ignore close errors.
    });
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== tabId);
      setActiveTabId((prevActive) => {
        if (prevActive !== tabId) {
          return prevActive;
        }
        return next[next.length - 1]?.id ?? null;
      });
      return next;
    });
  }, []);

  // Listen for PTY output & exit events.
  useEffect(() => {
    let disposed = false;
    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    void listen<TerminalOutputPayload>("terminal-output", (event) => {
      if (disposed) {
        return;
      }
      const instance = instancesRef.current.get(event.payload.terminalId);
      instance?.terminal.write(event.payload.data);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        unlistenOutput = unlisten;
      }
    });

    void listen<TerminalExitPayload>("terminal-exit", (event) => {
      if (disposed) {
        return;
      }
      const { terminalId, code } = event.payload;
      const instance = instancesRef.current.get(terminalId);
      instance?.terminal.writeln(
        `\r\n\x1b[90m[Process exited${code !== null ? ` with code ${code}` : ""}]\x1b[0m`,
      );
      setTabs((current) =>
        current.map((tab) =>
          tab.id === terminalId ? { ...tab, exited: true, exitCode: code } : tab,
        ),
      );
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        unlistenExit = unlisten;
      }
    });

    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
    };
  }, []);

  // Sync xterm theme when app theme changes.
  useEffect(() => {
    for (const instance of instancesRef.current.values()) {
      instance.terminal.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  // Show only the active terminal container, fit & focus when active.
  useEffect(() => {
    for (const [id, instance] of instancesRef.current.entries()) {
      const isSelected = id === activeTabId;
      instance.container.style.display = isSelected ? "block" : "none";
    }
    if (active && activeTabId) {
      const raf = requestAnimationFrame(() => {
        fitAndResizeTab(activeTabId);
        instancesRef.current.get(activeTabId)?.terminal.focus();
      });
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [active, activeTabId, fitAndResizeTab]);

  // Auto-open the first terminal tab the first time the panel becomes active.
  useEffect(() => {
    if (!active || hasAutoStartedRef.current) {
      return;
    }
    hasAutoStartedRef.current = true;
    void createTerminalTab();
  }, [active, createTerminalTab]);

  // Fit active terminal on container resize.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (active && activeTabId) {
        fitAndResizeTab(activeTabId);
      }
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [active, activeTabId, fitAndResizeTab]);

  // Clean up all PTY sessions on unmount.
  useEffect(() => {
    const instances = instancesRef.current;
    return () => {
      for (const [id, instance] of instances.entries()) {
        instance.dispose();
        void invoke("terminal_close", { terminalId: id }).catch(() => {});
      }
      instances.clear();
    };
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-1.5 border-b border-line px-2.5 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {tabs.map((tab, index) => {
            const isSelected = tab.id === activeTabId;
            return (
              <div
                className={`group flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                  isSelected
                    ? "bg-surface-subtle font-medium text-ink"
                    : "text-muted hover:bg-surface-subtle/60 hover:text-ink"
                }`}
                key={tab.id}
              >
                <button
                  className="flex items-center gap-1"
                  onClick={() => setActiveTabId(tab.id)}
                  title={tab.cwd}
                  type="button"
                >
                  <TerminalIcon size={12} />
                  <span>
                    {tab.title} {tabs.length > 1 ? index + 1 : ""}
                  </span>
                </button>
                <button
                  aria-label={`Close ${tab.title}`}
                  className="rounded p-0.5 text-muted opacity-65 transition-opacity hover:bg-surface-hover hover:text-ink group-hover:opacity-100"
                  onClick={() => closeTerminalTab(tab.id)}
                  title="Close terminal"
                  type="button"
                >
                  <CloseIcon size={10} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {activeTabId ? (
            <button
              aria-label="Clear terminal"
              className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-surface-subtle hover:text-ink"
              onClick={() => {
                instancesRef.current.get(activeTabId)?.terminal.clear();
                instancesRef.current.get(activeTabId)?.terminal.focus();
              }}
              title="Clear"
              type="button"
            >
              <RefreshIcon size={12} />
            </button>
          ) : null}
          <button
            aria-label="New terminal"
            className="grid h-6 w-6 place-items-center rounded-md text-muted transition-colors hover:bg-surface-subtle hover:text-ink disabled:opacity-40"
            disabled={creating}
            onClick={() => void createTerminalTab()}
            title="New terminal"
            type="button"
          >
            <PlusIcon size={13} />
          </button>
        </div>
      </div>

      {activeTab ? (
        <div className="truncate border-b border-line/70 px-3 py-1 text-[10.5px] text-muted">
          {activeTab.cwd}
        </div>
      ) : null}

      {error ? (
        <div className="m-3 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </div>
      ) : null}

      {tabs.length === 0 && !creating && !error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-xs text-muted">暂无活动终端</p>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-subtle px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-hover"
            onClick={() => void createTerminalTab()}
            type="button"
          >
            <PlusIcon size={13} />
            <span>新建终端</span>
          </button>
        </div>
      ) : null}

      <div
        className={`min-h-0 flex-1 px-2 py-2 ${
          tabs.length === 0 ? "hidden" : "block"
        }`}
        ref={stageRef}
      />
    </div>
  );
}
