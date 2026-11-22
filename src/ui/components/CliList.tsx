import { homedir } from "node:os";

import { Box, Text } from "ink";

import {
  CLI_IDS,
  cliSource,
  type CliId,
  type DetectedCli,
} from "../../models/cli";
import { theme } from "../theme";

const CLI_NAMES: Readonly<Record<CliId, string>> = {
  codex: "Codex",
  claude: "Claude Code",
  pi: "Pi",
  omp: "OMP",
};

export interface CliListProps {
  readonly clis: readonly DetectedCli[];
  readonly selectedIndex?: number;
}

export function cliDisplayName(id: CliId): string {
  return CLI_NAMES[id];
}

function abbreviatePath(value: string, maxLength = 46): string {
  const home = homedir();
  const withHome = value === home
    ? "~"
    : value.startsWith(`${home}/`)
      ? `~/${value.slice(home.length + 1)}`
      : value;

  if (withHome.length <= maxLength) {
    return withHome;
  }

  const available = Math.max(1, maxLength - 1);
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return `${withHome.slice(0, headLength)}…${withHome.slice(-tailLength)}`;
}

/** Reduce raw `--version` output to the bare version token when one is present. */
function compactVersion(version: string | null): string {
  if (!version) {
    return "—";
  }

  const match = version.match(/\d+(?:\.\d+)+/);
  return match ? match[0] : version;
}

function versionLabel(version: string | null): string {
  const compact = compactVersion(version);
  return compact === "—" ? "版本未知" : `v${compact}`;
}

function platformLabel(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return "macOS";
  }
  if (platform === "win32") {
    return "Windows";
  }
  if (platform === "linux") {
    return "Linux";
  }
  return platform;
}

/** Shows the OS and install channel. */
function originLabel(cli: DetectedCli): string {
  return `${platformLabel(process.platform)} · ${cliSource(cli)}`;
}

function detailLine(cli: DetectedCli): string {
  if (!cli.available) {
    // 安装指引集中在 doctor：这里只负责把用户送过去。
    return `未发现 ${cli.bin}  ·  运行 coderelay doctor 查看安装方式`;
  }

  return `${versionLabel(cli.version)}  ·  ${abbreviatePath(cli.path)}  ·  ${originLabel(cli)}`;
}

export function CliList({ clis, selectedIndex = 0 }: CliListProps) {
  const ordered = CLI_IDS.map((id) => clis.find((cli) => cli.id === id)).filter(
    (cli): cli is DetectedCli => Boolean(cli),
  );
  const selected = ordered[selectedIndex];

  return (
    <Box flexDirection="column" paddingX={2}>
      <Box marginBottom={1}>
        <Text bold color={theme.text}>
          这一棒交给谁？
        </Text>
      </Box>

      <Box flexDirection="row" flexWrap="wrap">
        {ordered.map((cli, index) => {
          const active = index === selectedIndex;
          const label = `${cli.available ? "●" : "○"} ${cliDisplayName(cli.id)}`;
          const underlineWidth = label.length;

          return (
            <Box
              key={cli.id}
              flexDirection="column"
              marginRight={index < ordered.length - 1 ? 3 : 0}
            >
              {/* 选中态固定只占一行，切换时不会改变标签宽度或挤动相邻项。 */}
              <Text>
                <Text color={cli.available ? theme.ok : theme.alert}>
                  {cli.available ? "●" : "○"}
                </Text>
                <Text bold={active} color={active ? theme.text : theme.muted}>
                  {` ${cliDisplayName(cli.id)}`}
                </Text>
              </Text>
              {/* 只给当前项画下划线，其余项保留等宽空白，避免切换时整行跳动。 */}
              <Text color={theme.accent}>
                {active ? "─".repeat(underlineWidth) : " ".repeat(underlineWidth)}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} height={1}>
        {selected ? (
          <Text color={theme.muted} wrap="truncate-end">
            {detailLine(selected)}
          </Text>
        ) : (
          <Text> </Text>
        )}
      </Box>
    </Box>
  );
}
