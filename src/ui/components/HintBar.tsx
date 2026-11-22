import { Box, Text } from "ink";

import { theme } from "../theme";

export type HintContext =
  "scanning" | "activating" | "mode" | "picker" | "chat" | "running" | "detail";

export interface HintBarProps {
  readonly context: HintContext;
}

interface Hint {
  readonly key: string;
  readonly label: string;
}

const HINTS: Readonly<Record<Exclude<HintContext, "scanning">, readonly Hint[]>> = {
  activating: [
    { key: "↑↓", label: "移动" },
    { key: "space", label: "切换" },
    { key: "↵", label: "保存" },
    { key: "esc", label: "取消" },
  ],
  mode: [
    { key: "←→", label: "移动" },
    { key: "↵", label: "选择" },
    { key: "ctrl c", label: "退出" },
  ],
  picker: [
    { key: "←→", label: "移动" },
    { key: "↵", label: "选择" },
    { key: "esc", label: "返回" },
    { key: "ctrl c", label: "退出" },
  ],
  chat: [
    { key: "↵", label: "发送" },
    { key: "/model", label: "切换 agent" },
    { key: "tab", label: "交互模式" },
    { key: "esc", label: "返回" },
    { key: "ctrl c", label: "退出" },
  ],
  running: [{ key: "esc / ctrl c", label: "中止任务" }],
  detail: [
    { key: "↵ / esc", label: "返回" },
    { key: "ctrl c", label: "退出" },
  ],
};

/**
 * 底部键位条：常驻在窗口最后一行，不参与滚动内容。
 * 键帽用强调色加粗——「这里能按」；键帽不加内边距，避免挤爆窄终端。
 */
export function HintBar({ context }: HintBarProps) {
  if (context === "scanning") {
    return <Text color={theme.muted}>扫描完成后自动进入选择，稍等一下。</Text>;
  }

  return (
    <Box flexDirection="row">
      {HINTS[context].map((hint, index) => (
        <Text key={hint.key}>
          {index > 0 ? <Text color={theme.muted}>{"  ·  "}</Text> : null}
          <Text bold color={theme.accent}>
            {hint.key}
          </Text>
          <Text color={theme.muted}>{` ${hint.label}`}</Text>
        </Text>
      ))}
    </Box>
  );
}
