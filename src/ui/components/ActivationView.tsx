import { Box, Text } from "ink";

import type { ActivationOption } from "../../config/activation";
import { theme } from "../theme";
import { cliDisplayName } from "./CliList";

export type ActivationMode = "confirm" | "manage";

export interface ActivationViewProps {
  readonly mode: ActivationMode;
  readonly options: readonly ActivationOption[];
  /** Index into `options`; unselectable rows are skipped by the caller. */
  readonly cursor: number;
}

/** Rows the cursor may land on: installed CLIs are the only ones worth toggling. */
export function selectableIndices(options: readonly ActivationOption[]): readonly number[] {
  return options
    .map((option, index) => (option.available ? index : -1))
    .filter((index) => index >= 0);
}

export function isSelectable(options: readonly ActivationOption[], index: number): boolean {
  return options[index]?.available === true;
}

/** Next selectable index in `delta` direction, wrapping; -1 when none exist. */
export function moveCursor(
  options: readonly ActivationOption[],
  current: number,
  delta: number,
): number {
  const selectable = selectableIndices(options);
  if (selectable.length === 0) {
    return -1;
  }

  if (!isSelectable(options, current)) {
    return selectable[0] ?? -1;
  }

  const position = selectable.indexOf(current);
  const next = (position + delta + selectable.length) % selectable.length;
  return selectable[next] ?? -1;
}

function statusText(option: ActivationOption): string {
  if (!option.available) {
    return "未安装";
  }
  return option.enabled ? "已激活" : "已禁用";
}

function statusColor(option: ActivationOption): string | undefined {
  if (!option.available) {
    return theme.alert;
  }
  return option.enabled ? theme.ok : theme.muted;
}

export function ActivationView({ mode, options, cursor }: ActivationViewProps) {
  const activeCount = options.filter((option) => option.available && option.enabled).length;

  return (
    <Box flexDirection="column" paddingX={2}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color={theme.text}>
          {mode === "confirm" ? "激活 CLI" : "管理 CLI 激活状态"}
        </Text>
        <Text color={theme.muted}>
          {mode === "confirm"
            ? "以下是本机新发现的 CLI，选中要交给 coderelay 使用的那些。"
            : "按空格切换激活状态；未安装的 CLI 无法激活。"}
        </Text>
      </Box>

      {options.map((option, index) => {
        const focused = index === cursor && option.available;
        const marker = focused ? "❯" : " ";
        const box = option.enabled ? "[x]" : "[ ]";
        const name = cliDisplayName(option.cliId);
        const nameWidth = 12;

        return (
          <Text key={option.cliId}>
            <Text color={theme.accent}>{`${marker} `}</Text>
            <Text bold={focused} color={option.available ? theme.text : theme.muted}>
              {`${box} ${name}`}
            </Text>
            <Text color={theme.muted}>{" ".repeat(Math.max(1, nameWidth - name.length))}</Text>
            <Text color={statusColor(option)}>{statusText(option)}</Text>
          </Text>
        );
      })}

      <Box marginTop={1} flexDirection="column">
        {activeCount === 0 ? (
          <Text color={theme.alert}>
            当前没有已激活的 CLI，自动路由将无法执行任务；可稍后用 /activate 重新启用。
          </Text>
        ) : null}
        <Text color={theme.muted}>激活状态会保存到 ~/.coderelay/config.yaml</Text>
      </Box>
    </Box>
  );
}
