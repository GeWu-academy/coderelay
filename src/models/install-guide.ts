/**
 * Official installation metadata, kept in one read-only table.
 *
 * Nothing here is ever executed: `agents` and `doctor` only print these
 * commands so the user can copy them. Package names and install entry points
 * change often, so every command lives here rather than being scattered
 * across the scanner, launcher and UI.
 */
import type { CliId, CliSource } from "./cli";

/** Platform an install command targets. */
export type InstallPlatform = "darwin" | "linux" | "win32";

export interface InstallGuideEntry {
  readonly platform: InstallPlatform;
  readonly source: CliSource;
  readonly command: string;
  /** Only meaningful on the platform(s) named here; omitted when universal. */
  readonly prerequisites?: string;
  readonly verify: string;
  readonly note?: string;
}

export interface InstallGuide {
  readonly cliId: CliId;
  readonly label: string;
  readonly docs: string;
  readonly entries: readonly InstallGuideEntry[];
}

const PI_NPM_PACKAGE = "@earendil-works/pi-coding-agent";
const PI_LEGACY_NPM_PACKAGE = "@mariozechner/pi-coding-agent";
const OMP_NPM_PACKAGE = "@oh-my-pi/pi-coding-agent";

export const INSTALL_GUIDES: Readonly<Record<CliId, InstallGuide>> = {
  codex: {
    cliId: "codex",
    label: "Codex",
    docs: "https://github.com/openai/codex",
    entries: [
      {
        platform: "darwin",
        source: "installer",
        command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
        verify: "codex --version",
      },
      {
        platform: "linux",
        source: "installer",
        command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
        verify: "codex --version",
      },
      {
        platform: "darwin",
        source: "npm",
        command: "npm install -g @openai/codex",
        verify: "codex --version",
      },
      {
        platform: "linux",
        source: "npm",
        command: "npm install -g @openai/codex",
        verify: "codex --version",
      },
      {
        platform: "win32",
        source: "npm",
        command: "npm install -g @openai/codex",
        verify: "codex --version",
        note: "OpenAI 未发布 Windows 原生安装脚本，Windows 环境请使用 npm 安装。",
      },
      {
        platform: "darwin",
        source: "brew",
        command: "brew install codex",
        prerequisites: "Homebrew",
        verify: "codex --version",
      },
    ],
  },
  claude: {
    cliId: "claude",
    label: "Claude Code",
    docs: "https://claude.com/claude-code",
    entries: [
      {
        platform: "darwin",
        source: "installer",
        command: "curl -fsSL https://claude.ai/install.sh | bash",
        verify: "claude --version",
      },
      {
        platform: "linux",
        source: "installer",
        command: "curl -fsSL https://claude.ai/install.sh | bash",
        verify: "claude --version",
      },
      {
        platform: "win32",
        source: "installer",
        command: "irm https://claude.ai/install.ps1 | iex",
        prerequisites: "PowerShell",
        verify: "claude --version",
      },
      {
        platform: "win32",
        source: "installer",
        command:
          "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd",
        prerequisites: "CMD",
        verify: "claude --version",
      },
      {
        platform: "win32",
        source: "winget",
        command: "winget install Anthropic.ClaudeCode",
        verify: "claude --version",
      },
      {
        platform: "darwin",
        source: "brew",
        command: "brew install --cask claude-code",
        prerequisites: "Homebrew",
        verify: "claude --version",
      },
      {
        platform: "darwin",
        source: "npm",
        command: "npm install -g @anthropic-ai/claude-code",
        verify: "claude --version",
      },
      {
        platform: "linux",
        source: "npm",
        command: "npm install -g @anthropic-ai/claude-code",
        verify: "claude --version",
      },
      {
        platform: "win32",
        source: "npm",
        command: "npm install -g @anthropic-ai/claude-code",
        verify: "claude --version",
      },
    ],
  },
  pi: {
    cliId: "pi",
    label: "Pi",
    docs: "https://pi.dev",
    entries: [
      {
        platform: "darwin",
        source: "installer",
        command: "curl -fsSL https://pi.dev/install.sh | sh",
        verify: "pi --version",
      },
      {
        platform: "linux",
        source: "installer",
        command: "curl -fsSL https://pi.dev/install.sh | sh",
        verify: "pi --version",
      },
      {
        platform: "darwin",
        source: "npm",
        command: `npm install -g --ignore-scripts ${PI_NPM_PACKAGE}`,
        verify: "pi --version",
        note: `历史包名仍可用：${PI_LEGACY_NPM_PACKAGE}`,
      },
      {
        platform: "linux",
        source: "npm",
        command: `npm install -g --ignore-scripts ${PI_NPM_PACKAGE}`,
        verify: "pi --version",
        note: `历史包名仍可用：${PI_LEGACY_NPM_PACKAGE}`,
      },
      {
        platform: "win32",
        source: "npm",
        command: `npm install -g --ignore-scripts ${PI_NPM_PACKAGE}`,
        verify: "pi --version",
        note: `历史包名仍可用：${PI_LEGACY_NPM_PACKAGE}`,
      },
    ],
  },
  omp: {
    cliId: "omp",
    label: "OMP",
    docs: "https://omp.sh",
    entries: [
      {
        platform: "darwin",
        source: "installer",
        command: "curl -fsSL https://omp.sh/install | sh",
        verify: "omp --version",
      },
      {
        platform: "linux",
        source: "installer",
        command: "curl -fsSL https://omp.sh/install | sh",
        verify: "omp --version",
      },
      {
        platform: "win32",
        source: "installer",
        command: "irm https://omp.sh/install.ps1 | iex",
        prerequisites: "PowerShell",
        verify: "omp --version",
      },
      {
        platform: "darwin",
        source: "brew",
        command: "brew install can1357/tap/omp",
        prerequisites: "Homebrew",
        verify: "omp --version",
      },
      {
        platform: "darwin",
        source: "bun",
        command: `bun install -g ${OMP_NPM_PACKAGE}`,
        prerequisites: "Bun >= 1.3.14",
        verify: "omp --version",
      },
      {
        platform: "linux",
        source: "bun",
        command: `bun install -g ${OMP_NPM_PACKAGE}`,
        prerequisites: "Bun >= 1.3.14",
        verify: "omp --version",
      },
      {
        platform: "win32",
        source: "bun",
        command: `bun install -g ${OMP_NPM_PACKAGE}`,
        prerequisites: "Bun >= 1.3.14",
        verify: "omp --version",
      },
      {
        platform: "darwin",
        source: "nix",
        command: "nix profile install github:can1357/oh-my-pi",
        prerequisites: "Nix",
        verify: "omp --version",
        note: "临时运行：nix run github:can1357/oh-my-pi",
      },
      {
        platform: "linux",
        source: "nix",
        command: "nix profile install github:can1357/oh-my-pi",
        prerequisites: "Nix",
        verify: "omp --version",
        note: "临时运行：nix run github:can1357/oh-my-pi",
      },
      {
        platform: "darwin",
        source: "mise",
        command: "mise use -g github:can1357/oh-my-pi",
        prerequisites: "mise",
        verify: "omp --version",
      },
      {
        platform: "linux",
        source: "mise",
        command: "mise use -g github:can1357/oh-my-pi",
        prerequisites: "mise",
        verify: "omp --version",
      },
    ],
  },
};

export function installGuide(cliId: CliId): InstallGuide {
  return INSTALL_GUIDES[cliId];
}

/**
 * Install entries for one CLI on one platform.
 */
export function installEntriesFor(
  cliId: CliId,
  platform: InstallPlatform,
): readonly InstallGuideEntry[] {
  return INSTALL_GUIDES[cliId].entries.filter((entry) => entry.platform === platform);
}

export function installPlatformFor(platform: NodeJS.Platform): InstallPlatform {
  if (platform === "darwin" || platform === "win32") {
    return platform;
  }
  return "linux";
}

/**
 * Copy-ready install lines for one CLI on one platform, newest channel first.
 * These are printed only — coderelay never runs an install command, edits
 * PATH, or pipes a remote script into a shell.
 */
export function installHintLines(
  cliId: CliId,
  platform: InstallPlatform,
  limit = 3,
): readonly string[] {
  const guide = INSTALL_GUIDES[cliId];
  const entries = installEntriesFor(cliId, platform).slice(0, limit);
  const verify = guide.entries[0]?.verify ?? `${cliId} --version`;

  return [
    ...entries.map((entry) => {
      const channel = entry.prerequisites
        ? `${entry.source}（需要 ${entry.prerequisites}）`
        : entry.source;
      const note = entry.note ? `  // ${entry.note}` : "";
      return `${channel}: ${entry.command}${note}`;
    }),
    `验证: ${verify}`,
    `文档: ${guide.docs}`,
  ];
}
