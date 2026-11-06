import { LayoutGroup } from "motion/react";

import type { WorkspaceView } from "../types";
import {
  HistoryIcon,
  HomeIcon,
  KeyIcon,
  SettingsIcon,
  StatsIcon,
} from "./icons";
import { LiquidRouteIndicator } from "./LiquidRouteIndicator";

export interface IconRailProps {
  currentView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
}

const RAIL_BTN_BASE =
  "relative grid h-[34px] w-[34px] place-items-center rounded-[9px] bg-transparent transition-colors duration-140 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900/20 [&>svg]:relative [&>svg]:z-1 [&>span]:relative [&>span]:z-1";

function railBtnClass(active: boolean): string {
  return `${RAIL_BTN_BASE} ${
    active
      ? "text-ink hover:bg-transparent hover:text-ink"
      : "text-muted hover:bg-surface-subtle hover:text-ink"
  }`;
}

export function IconRail({
  currentView,
  onSelectView,
}: IconRailProps) {
  return (
    <LayoutGroup id="rail-route-group">
      <nav
        className="z-10 flex min-h-0 w-[52px] shrink-0 basis-[52px] flex-col items-center border-r border-line bg-rail py-3"
        aria-label="Navigation"
      >
        <div className="flex flex-col items-center gap-2">
          <button
            aria-label="Workspace"
            className={railBtnClass(currentView === "workspace")}
            onClick={() => onSelectView("workspace")}
            title="Workspace"
            type="button"
          >
            {currentView === "workspace" ? (
              <LiquidRouteIndicator layoutId="rail-active-pill" variant="glass" />
            ) : null}
            <HomeIcon />
          </button>
          <button
            aria-label="Sessions"
            className={railBtnClass(currentView === "sessions")}
            onClick={() => onSelectView("sessions")}
            title="Sessions"
            type="button"
          >
            {currentView === "sessions" ? (
              <LiquidRouteIndicator layoutId="rail-active-pill" variant="glass" />
            ) : null}
            <HistoryIcon />
          </button>
          <button
            aria-label="Stats"
            className={railBtnClass(currentView === "stats")}
            onClick={() => onSelectView("stats")}
            title="Stats"
            type="button"
          >
            {currentView === "stats" ? (
              <LiquidRouteIndicator layoutId="rail-active-pill" variant="glass" />
            ) : null}
            <StatsIcon />
          </button>
        </div>
        <div className="mt-auto flex flex-col items-center gap-2">
          <button
            aria-label="API Keys"
            className={railBtnClass(currentView === "apikeys")}
            onClick={() => onSelectView("apikeys")}
            title="API Keys"
            type="button"
          >
            {currentView === "apikeys" ? (
              <LiquidRouteIndicator layoutId="rail-active-pill" variant="glass" />
            ) : null}
            <KeyIcon size={16} />
          </button>
          <button
            aria-label="Settings"
            className={railBtnClass(currentView === "config")}
            onClick={() => onSelectView("config")}
            title="Settings"
            type="button"
          >
            {currentView === "config" ? (
              <LiquidRouteIndicator layoutId="rail-active-pill" variant="glass" />
            ) : null}
            <SettingsIcon />
          </button>
        </div>
      </nav>
    </LayoutGroup>
  );
}
