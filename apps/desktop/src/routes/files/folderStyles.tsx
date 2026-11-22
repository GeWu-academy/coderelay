import {
  AppWindow,
  Archive,
  BookOpen,
  Cloud,
  Code,
  Compass,
  Cube,
  Database,
  Flask,
  Folder,
  FolderOpen,
  GitDiff,
  Image,
  Package,
  Palette,
  RocketLaunch,
  Shield,
  SlidersHorizontal,
  Sparkle,
  Terminal,
  Wrench,
  type Icon as PhosphorIcon,
  type IconWeight,
} from "@phosphor-icons/react";

import type { FolderStyleId } from "../../types";

export const FOLDER_SEMANTIC_KINDS = [
  "default",
  "apps",
  "src",
  "packages",
  "components",
  "routes",
  "stores",
  "utils",
  "docs",
  "deploy",
  "tooling",
  "changes",
  "tests",
  "config",
  "assets",
  "scripts",
  "styles",
  "api",
  "security",
  "build",
] as const;
export type FolderSemanticKind = (typeof FOLDER_SEMANTIC_KINDS)[number];

export function isFolderSemanticKind(value: unknown): value is FolderSemanticKind {
  return (FOLDER_SEMANTIC_KINDS as readonly unknown[]).includes(value);
}

export interface FolderSemanticMeta {
  readonly kind: FolderSemanticKind;
  readonly aliases: readonly string[];
  readonly colorClass: string;
  readonly icon: PhosphorIcon;
}

export const FOLDER_SEMANTIC_TABLE: Readonly<Record<FolderSemanticKind, FolderSemanticMeta>> =
  Object.freeze({
    default: Object.freeze({
      kind: "default",
      aliases: Object.freeze([]),
      colorClass: "text-amber-600/85 dark:text-amber-400/85",
      icon: Folder,
    }),
    apps: Object.freeze({
      kind: "apps",
      aliases: Object.freeze([
        "apps",
        "app",
        "applications",
        "desktop",
        "web",
        "mobile",
        "client",
        "clients",
      ]),
      colorClass: "text-sky-600 dark:text-sky-400",
      icon: AppWindow,
    }),
    src: Object.freeze({
      kind: "src",
      aliases: Object.freeze(["src", "source", "sources", "lib", "core", "internal"]),
      colorClass: "text-blue-600 dark:text-blue-400",
      icon: Code,
    }),
    packages: Object.freeze({
      kind: "packages",
      aliases: Object.freeze([
        "packages",
        "package",
        "pkg",
        "pkgs",
        "modules",
        "crates",
        "plugins",
        "extensions",
      ]),
      colorClass: "text-emerald-600 dark:text-emerald-400",
      icon: Package,
    }),
    components: Object.freeze({
      kind: "components",
      aliases: Object.freeze([
        "components",
        "component",
        "ui",
        "widgets",
        "views",
        "layouts",
        "layout",
        "elements",
      ]),
      colorClass: "text-cyan-600 dark:text-cyan-400",
      icon: Cube,
    }),
    routes: Object.freeze({
      kind: "routes",
      aliases: Object.freeze(["routes", "route", "pages", "page", "screens", "router", "navigation"]),
      colorClass: "text-indigo-600 dark:text-indigo-400",
      icon: Compass,
    }),
    stores: Object.freeze({
      kind: "stores",
      aliases: Object.freeze([
        "stores",
        "store",
        "state",
        "data",
        "db",
        "database",
        "models",
        "schemas",
      ]),
      colorClass: "text-violet-600 dark:text-violet-400",
      icon: Database,
    }),
    utils: Object.freeze({
      kind: "utils",
      aliases: Object.freeze(["utils", "util", "helpers", "helper", "shared", "common", "hooks"]),
      colorClass: "text-teal-600 dark:text-teal-400",
      icon: Sparkle,
    }),
    docs: Object.freeze({
      kind: "docs",
      aliases: Object.freeze(["docs", "doc", "documentation", "guides", "guide", "wiki", "notes"]),
      colorClass: "text-purple-600 dark:text-purple-400",
      icon: BookOpen,
    }),
    deploy: Object.freeze({
      kind: "deploy",
      aliases: Object.freeze([
        "deploy",
        "deployment",
        "deployments",
        "infra",
        "infrastructure",
        "docker",
        "k8s",
        "ci",
        "cd",
        "release",
        "releases",
      ]),
      colorClass: "text-orange-600 dark:text-orange-400",
      icon: RocketLaunch,
    }),
    tooling: Object.freeze({
      kind: "tooling",
      aliases: Object.freeze(["tooling", "tools", "tool", "cli", "devtools", "generators"]),
      colorClass: "text-amber-600 dark:text-amber-400",
      icon: Wrench,
    }),
    changes: Object.freeze({
      kind: "changes",
      aliases: Object.freeze([
        "changes",
        "change",
        "changelog",
        "changelogs",
        "migrations",
        "patches",
        "diffs",
      ]),
      colorClass: "text-rose-600 dark:text-rose-400",
      icon: GitDiff,
    }),
    tests: Object.freeze({
      kind: "tests",
      aliases: Object.freeze([
        "tests",
        "test",
        "__tests__",
        "spec",
        "specs",
        "e2e",
        "fixtures",
        "mocks",
      ]),
      colorClass: "text-green-600 dark:text-green-400",
      icon: Flask,
    }),
    config: Object.freeze({
      kind: "config",
      aliases: Object.freeze(["config", "configs", "settings", "env", "preferences"]),
      colorClass: "text-slate-600 dark:text-slate-400",
      icon: SlidersHorizontal,
    }),
    assets: Object.freeze({
      kind: "assets",
      aliases: Object.freeze([
        "assets",
        "asset",
        "images",
        "img",
        "media",
        "static",
        "public",
        "icons",
        "fonts",
      ]),
      colorClass: "text-pink-600 dark:text-pink-400",
      icon: Image,
    }),
    scripts: Object.freeze({
      kind: "scripts",
      aliases: Object.freeze(["scripts", "script", "bin", "cmd", "tasks", "automation"]),
      colorClass: "text-lime-600 dark:text-lime-400",
      icon: Terminal,
    }),
    styles: Object.freeze({
      kind: "styles",
      aliases: Object.freeze(["styles", "style", "css", "themes", "theme"]),
      colorClass: "text-fuchsia-600 dark:text-fuchsia-400",
      icon: Palette,
    }),
    api: Object.freeze({
      kind: "api",
      aliases: Object.freeze([
        "api",
        "apis",
        "server",
        "backend",
        "services",
        "service",
        "rpc",
        "graphql",
        "endpoints",
      ]),
      colorClass: "text-sky-700 dark:text-sky-300",
      icon: Cloud,
    }),
    security: Object.freeze({
      kind: "security",
      aliases: Object.freeze(["security", "auth", "certs", "keys", "secrets"]),
      colorClass: "text-red-600 dark:text-red-400",
      icon: Shield,
    }),
    build: Object.freeze({
      kind: "build",
      aliases: Object.freeze(["dist", "build", "out", "output", "target", "artifacts", "coverage"]),
      colorClass: "text-zinc-500 dark:text-zinc-400",
      icon: Archive,
    }),
  });

const ALIAS_TO_SEMANTIC_KIND: ReadonlyMap<string, FolderSemanticKind> = (() => {
  const map = new Map<string, FolderSemanticKind>();
  for (const kind of FOLDER_SEMANTIC_KINDS) {
    const meta = FOLDER_SEMANTIC_TABLE[kind];
    for (const alias of meta.aliases) {
      map.set(alias, kind);
    }
  }
  return map;
})();

export function resolveFolderSemanticKind(folderName: string): FolderSemanticKind {
  const normalized = folderName.trim().toLowerCase();
  if (!normalized) {
    return "default";
  }

  const exact = ALIAS_TO_SEMANTIC_KIND.get(normalized);
  if (exact) {
    return exact;
  }

  const tokens = normalized.split(/[-_.\s]+/).filter((token) => token.length > 1);
  for (const token of tokens) {
    const matched = ALIAS_TO_SEMANTIC_KIND.get(token);
    if (matched) {
      return matched;
    }
  }

  return "default";
}

export interface SemanticFolderIconProps {
  name: string;
  isExpanded?: boolean;
  styleId: FolderStyleId;
  size?: number;
  className?: string;
}

export function SemanticFolderIcon({
  name,
  isExpanded = false,
  styleId,
  size = 14,
  className = "",
}: SemanticFolderIconProps) {
  if (styleId === "clean") {
    const toneClass = isExpanded ? "text-ink" : "text-muted-strong";
    return (
      <Folder
        aria-hidden="true"
        data-folder-style="clean"
        data-folder-semantic="default"
        size={size}
        weight="regular"
        className={`block shrink-0 ${toneClass} ${className}`.trim()}
      />
    );
  }

  const semanticKind = resolveFolderSemanticKind(name);
  const meta = FOLDER_SEMANTIC_TABLE[semanticKind];

  if (styleId === "tinted-folder") {
    const IconComponent = isExpanded ? FolderOpen : Folder;
    return (
      <IconComponent
        aria-hidden="true"
        data-folder-style="tinted-folder"
        data-folder-semantic={semanticKind}
        size={size}
        weight="duotone"
        className={`block shrink-0 ${meta.colorClass} ${className}`.trim()}
      />
    );
  }

  const IconComponent: PhosphorIcon =
    semanticKind === "default" ? (isExpanded ? FolderOpen : Folder) : meta.icon;

  if (styleId === "semantic-mono") {
    const toneClass = isExpanded ? "text-ink" : "text-muted-strong";
    return (
      <IconComponent
        aria-hidden="true"
        data-folder-style="semantic-mono"
        data-folder-semantic={semanticKind}
        size={size}
        weight="regular"
        className={`block shrink-0 ${toneClass} ${className}`.trim()}
      />
    );
  }

  const weight: IconWeight = "duotone";
  return (
    <IconComponent
      aria-hidden="true"
      data-folder-style="semantic-color"
      data-folder-semantic={semanticKind}
      size={size}
      weight={weight}
      className={`block shrink-0 ${meta.colorClass} ${className}`.trim()}
    />
  );
}
