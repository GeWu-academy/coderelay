import {
  ArrowUp,
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  ChartLineUp,
  Check,
  ClockCounterClockwise,
  Copy,
  File,
  Files,
  Folder,
  GearSix,
  House,
  Image,
  Key,
  Palette,
  Path,
  Plus,
  Shield,
  SidebarSimple,
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
export const PaletteIcon = createIcon(Palette, 15);
export const TrashIcon = createIcon(Trash, 14);
export const ImageIcon = createIcon(Image, 15);
export const FilesIcon = createIcon(Files, 18);
export const FileIcon = createIcon(File, 14);
export const ChevronRightIcon = createIcon(CaretRight, 12);
export const CopyIcon = createIcon(Copy, 14);
