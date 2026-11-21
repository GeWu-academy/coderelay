import { AnimatePresence, motion } from "motion/react";
import { useEffect, type ReactNode } from "react";

import { PanelLeftIcon } from "../components/icons";
import type { WorkspaceView } from "../types";

export interface WorkbenchLayoutProps {
  view: WorkspaceView;
  showLeftSidebar: boolean;
  sidebarCollapsed: boolean;
  sidebarPinned?: boolean;
  rightSidebarOpen: boolean;
  showBottomDock: boolean;
  customBackground?: string | null;
  customBackgroundOpacity?: number;
  onToggleSidebarShortcut?: () => void;
  onCollapseSidebar?: () => void;
  onExpandSidebar?: () => void;
  titlebar: ReactNode;
  iconRail: ReactNode;
  leftSidebar?: ReactNode;
  main: ReactNode;
  bottomDock?: ReactNode;
  rightSidebar: ReactNode;
}

/**
 * Pure page layout shell that decouples structural regions from feature components
 * and uniformly manages the component slots rendered on the workbench page.
 */
export function WorkbenchLayout({
  view,
  showLeftSidebar,
  sidebarCollapsed,
  sidebarPinned = false,
  rightSidebarOpen,
  showBottomDock,
  customBackground,
  customBackgroundOpacity = 1,
  onToggleSidebarShortcut,
  onCollapseSidebar,
  onExpandSidebar,
  titlebar,
  iconRail,
  leftSidebar,
  main,
  bottomDock,
  rightSidebar,
}: WorkbenchLayoutProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        onToggleSidebarShortcut &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        if (showLeftSidebar) {
          onToggleSidebarShortcut();
        }
        return;
      }
      if (
        event.key === "Escape" &&
        showLeftSidebar &&
        !sidebarPinned &&
        !sidebarCollapsed &&
        onCollapseSidebar
      ) {
        onCollapseSidebar();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCollapseSidebar, onToggleSidebarShortcut, showLeftSidebar, sidebarCollapsed, sidebarPinned]);

  return (
    <div className="relative flex h-dvh min-h-[600px] flex-col overflow-hidden bg-canvas">
      {customBackground ? (
        <div
          data-testid="custom-background-layer"
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat transition-opacity duration-300"
          style={{
            backgroundImage: `url(${customBackground})`,
            opacity: customBackgroundOpacity,
          }}
        />
      ) : null}

      {titlebar}

      <div
        className="flex min-h-0 flex-1 overflow-hidden bg-canvas"
        data-sidebar-collapsed={!showLeftSidebar || sidebarCollapsed}
        data-sidebar-pinned={sidebarPinned}
        data-right-sidebar-open={rightSidebarOpen}
      >
        {iconRail}

        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {showLeftSidebar ? leftSidebar : null}

          {showLeftSidebar && !sidebarPinned && !sidebarCollapsed ? (
            <div
              aria-hidden="true"
              className="absolute inset-0 z-20 bg-black/15 transition-opacity duration-200"
              data-testid="sidebar-drawer-backdrop"
              onClick={onCollapseSidebar}
            />
          ) : null}

          {showLeftSidebar && sidebarCollapsed && onExpandSidebar ? (
            <button
              aria-label="Expand sidebar"
              className="absolute top-3 left-3 z-15 grid h-7 w-7 place-items-center rounded-[7px] border border-line bg-surface/85 text-muted shadow-xs backdrop-blur-sm transition-colors duration-140 hover:bg-surface-subtle hover:text-ink"
              data-testid="sidebar-expand-trigger"
              onClick={onExpandSidebar}
              title="展开会话栏 (⌘B)"
              type="button"
            >
              <PanelLeftIcon size={15} />
            </button>
          ) : null}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas" data-view={view}>
          <AnimatePresence mode="wait">{main}</AnimatePresence>

          <AnimatePresence>
            {showBottomDock && bottomDock ? (
              <motion.div
                key="composer-dock"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                className="relative z-5 shrink-0 bg-[linear-gradient(180deg,transparent_0%,var(--color-canvas)_28%)] px-8 pt-2.5 pb-[18px]"
              >
                {bottomDock}
              </motion.div>
            ) : null}
          </AnimatePresence>
          </main>
        </div>

        {rightSidebar}
      </div>
    </div>
  );
}
