import {
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  ChartLineUp,
  Check,
  ClockCounterClockwise,
  Code,
  Copy,
  File,
  Files,
  Folder,
  GearSix,
  GitBranch,
  GitCommit,
  House,
  Image,
  Key,
  Minus,
  Palette,
  Path,
  Plus,
  Shield,
  SidebarSimple,
  Sparkle,
  Stop,
  Terminal,
  Trash,
  X,
  type Icon as PhosphorIcon,
  type IconWeight,
} from "@phosphor-icons/react";

export interface IconProps {
  size?: number | string;
  className?: string;
  weight?: IconWeight;
}

/**
 * Wrap a Phosphor icon component with a consistent default size, weight, and shrink-0 block layout.
 */
function createIcon(
  Component: PhosphorIcon,
  defaultSize = 18,
  defaultWeight: IconWeight = "regular",
) {
  return function WrappedIcon({
    size = defaultSize,
    className = "",
    weight = defaultWeight,
  }: IconProps = {}) {
    return (
      <Component
        aria-hidden="true"
        className={`block shrink-0 ${className}`.trim()}
        size={size}
        weight={weight}
      />
    );
  };
}

export const HomeIcon = createIcon(House, 18);
export const HistoryIcon = createIcon(ClockCounterClockwise, 18);
export const StatsIcon = createIcon(ChartLineUp, 18);
export const FolderIcon = createIcon(Folder, 16);
export const SettingsIcon = createIcon(GearSix, 18);
export const RefreshIcon = createIcon(ArrowsClockwise, 15);
export function AgentsIcon({
  size = 16,
  className = "",
}: IconProps = {}) {
  return (
    <svg
      aria-hidden="true"
      className={`block shrink-0 ${className}`.trim()}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M8 8V5.5A2 2 0 0 1 10 3.5h8.5a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2h-2" />
      <rect height="12" rx="3" width="13.5" x="3" y="8" />
      <circle cx="7.75" cy="14" fill="currentColor" r="1.15" stroke="none" />
      <circle cx="11.75" cy="14" fill="currentColor" r="1.15" stroke="none" />
    </svg>
  );
}
export const TerminalIcon = createIcon(Terminal, 16);
export const RouteIcon = createIcon(Path, 15);
export const ArrowUpIcon = createIcon(ArrowUp, 17);
export const StopIcon = createIcon(Stop, 16, "fill");
export const PanelLeftIcon = createIcon(SidebarSimple, 16);
export const PlusIcon = createIcon(Plus, 15);
export const ShieldIcon = createIcon(Shield, 14);
export const ChevronDownIcon = createIcon(CaretDown, 12);
export const CheckIcon = createIcon(Check, 15);
export const CloseIcon = createIcon(X, 14);
export const KeyIcon = createIcon(Key, 15);
export const CodeIcon = createIcon(Code, 15);
export const PaletteIcon = createIcon(Palette, 15);
export const TrashIcon = createIcon(Trash, 14);
export const ImageIcon = createIcon(Image, 15);
export const FilesIcon = createIcon(Files, 18);
export const FileIcon = createIcon(File, 14);
export const ChevronRightIcon = createIcon(CaretRight, 12);
export const CopyIcon = createIcon(Copy, 14);
export const GitBranchIcon = createIcon(GitBranch, 18);
export const GitCommitIcon = createIcon(GitCommit, 15);
export const MinusIcon = createIcon(Minus, 14);
export const ArrowDownIcon = createIcon(ArrowDown, 15);
export const UndoIcon = createIcon(ArrowCounterClockwise, 14);
export const SparkleIcon = createIcon(Sparkle, 14);
