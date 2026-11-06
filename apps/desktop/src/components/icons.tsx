import type { ReactNode } from "react";

export interface IconProps {
  children?: ReactNode;
  size?: number;
  className?: string;
}

export function Icon({ children, size = 18, className = "" }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={`block shrink-0 ${className}`.trim()}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.65"
    >
      {children}
    </svg>
  );
}

export function HomeIcon() {
  return (
    <Icon>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6.5 9.5V20h11V9.5" />
    </Icon>
  );
}

export function HistoryIcon() {
  return (
    <Icon>
      <path d="M4.6 9A8 8 0 1 1 4 12" />
      <path d="M4 5v4h4" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function StatsIcon({ size = 18 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </Icon>
  );
}

export function FolderIcon({ size = 16 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M3.5 7.5h6l1.8 2h9.2v8.8a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7Z" />
      <path d="M3.5 9.5V6.2c0-.94.76-1.7 1.7-1.7h4.1l1.8 2h7.2c.94 0 1.7.76 1.7 1.7v1.3" />
    </Icon>
  );
}

export function SettingsIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .55 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-1.55-1H2.5V10h.09A1.7 1.7 0 0 0 4.1 9a1.7 1.7 0 0 0-.34-1.88L3.7 7.06 6.56 4.2l.06.06A1.7 1.7 0 0 0 8.5 4.6a1.7 1.7 0 0 0 1-1.55V3h4v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1h.09v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
    </Icon>
  );
}

export function RefreshIcon({ size = 15 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M20 11a8 8 0 1 0-2.34 5.66" />
      <path d="M20 5v6h-6" />
    </Icon>
  );
}

export function TerminalIcon({ size = 16 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="m5 7 4 4-4 4" />
      <path d="M11 16h7" />
    </Icon>
  );
}

export function RouteIcon({ size = 15 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M8 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h-1" />
    </Icon>
  );
}

export function ArrowUpIcon({ size = 17 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M12 19V5" />
      <path d="m6.5 10.5 5.5-5.5 5.5 5.5" />
    </Icon>
  );
}

export function StopIcon({ size = 16 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function PanelLeftIcon({ size = 16 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 3v18" />
    </Icon>
  );
}

export function PlusIcon({ size = 15 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function ShieldIcon({ size = 14 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Icon>
  );
}

export function ChevronDownIcon({
  size = 12,
  className,
}: { size?: number; className?: string } = {}) {
  return (
    <Icon className={className} size={size}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function CheckIcon({ size = 15 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

export function CloseIcon({ size = 14 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

export function KeyIcon({ size = 15 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3" />
    </Icon>
  );
}

export function PaletteIcon({ size = 15 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.68 1.5-1.5 0-.38-.15-.74-.42-1.02-.27-.29-.42-.66-.42-1.05 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.5-4.5-10-10-10Z" />
    </Icon>
  );
}

export function TrashIcon({ size = 14 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M4 7h16" />
      <path d="M9 7V4.5h6V7" />
      <path d="M6.5 7 7.4 20h9.2L17.5 7" />
    </Icon>
  );
}

export function ImageIcon({ size = 15 }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </Icon>
  );
}
