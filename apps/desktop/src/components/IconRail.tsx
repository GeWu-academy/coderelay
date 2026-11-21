import type { ComponentType } from "react";
import { LayoutGroup } from "motion/react";

import type { WorkspaceView } from "../types";
import {
  FilesIcon,
  GitBranchIcon,
  HistoryIcon,
  HomeIcon,
  type IconProps,
  KeyIcon,
  SettingsIcon,
  StatsIcon,
} from "./icons";
import { LiquidRouteIndicator } from "./LiquidRouteIndicator";

export interface IconRailProps {
  currentView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
}

interface RailItem {
  view: WorkspaceView;
  label: string;
  title: string;
  icon: ComponentType<IconProps>;
  iconSize: number;
}

const TOP_ITEMS: readonly RailItem[] = [
  { view: "workspace", label: "工作区", title: "Workspace", icon: HomeIcon, iconSize: 19 },
  { view: "files", label: "文件", title: "Files", icon: FilesIcon, iconSize: 19 },
  { view: "scm", label: "源码", title: "Source Control", icon: GitBranchIcon, iconSize: 19 },
  { view: "sessions", label: "会话", title: "Sessions", icon: HistoryIcon, iconSize: 19 },
  { view: "stats", label: "统计", title: "Stats", icon: StatsIcon, iconSize: 19 },
];

const BOTTOM_ITEMS: readonly RailItem[] = [
  { view: "apikeys", label: "密钥", title: "API Keys", icon: KeyIcon, iconSize: 18 },
  { view: "config", label: "设置", title: "Settings", icon: SettingsIcon, iconSize: 19 },
];

const RAIL_BTN_BASE =
  "relative flex h-[48px] w-[54px] flex-col items-center justify-center gap-1 rounded-[10px] bg-transparent transition-colors duration-140 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900/20 [&>svg]:relative [&>svg]:z-1 [&>span]:relative [&>span]:z-1";

function railBtnClass(active: boolean): string {
  return `${RAIL_BTN_BASE} ${
    active
      ? "text-ink hover:bg-transparent hover:text-ink"
      : "text-muted hover:bg-surface-subtle hover:text-ink"
  }`;
}

function renderRailItems(
  items: readonly RailItem[],
  currentView: WorkspaceView,
  onSelectView: (view: WorkspaceView) => void,
) {
  return items.map(({ view, label, title, icon: Icon, iconSize }) => {
    const active = currentView === view;
    return (
      <button
        key={view}
        aria-label={title}
        className={railBtnClass(active)}
        onClick={() => onSelectView(view)}
        title={title}
        type="button"
      >
        {active ? (
          <LiquidRouteIndicator layoutId="rail-active-pill" variant="glass" />
        ) : null}
        <Icon size={iconSize} weight={active ? "duotone" : "regular"} />
        <span className="text-[10.5px] leading-none font-medium tracking-tight">{label}</span>
      </button>
    );
  });
}

export function IconRail({
  currentView,
  onSelectView,
}: IconRailProps) {
  return (
    <LayoutGroup id="rail-route-group">
      <nav
        className="z-10 flex min-h-0 w-[68px] shrink-0 basis-[68px] flex-col items-center border-r border-line bg-rail px-1.5 py-3"
        aria-label="Navigation"
      >
        <div className="flex flex-col items-center gap-1.5">
          {renderRailItems(TOP_ITEMS, currentView, onSelectView)}
        </div>
        <div className="mt-auto flex flex-col items-center gap-1.5 border-t border-line/60 pt-2.5">
          {renderRailItems(BOTTOM_ITEMS, currentView, onSelectView)}
        </div>
      </nav>
    </LayoutGroup>
  );
}
