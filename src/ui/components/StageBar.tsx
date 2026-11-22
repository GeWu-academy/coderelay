import { Box, Text, useWindowSize } from "ink";

import { theme } from "../theme";

/** 位置层的最小状态集合：detail（未安装详情）属于「选择」这一档。 */
export type Stage = "scan" | "select" | "compose" | "run" | "result";

const STEPS: readonly { readonly id: Stage; readonly label: string }[] = [
  { id: "scan", label: "扫描" },
  { id: "select", label: "选择" },
  { id: "compose", label: "写任务" },
  { id: "run", label: "执行" },
  { id: "result", label: "结果" },
];

const FOCUS_LABEL: Readonly<Record<Stage, string>> = {
  scan: "当前",
  select: "当前",
  compose: "交给",
  run: "交给",
  result: "本次",
};

/** 窄于这个宽度时，步骤和焦点分两行排，避免 Ink 把两者挤在一起换行。 */
const STACK_BELOW = 64;
/**
 * 结果档步骤轨尾部的「→ 选择」回环提示约加宽 7 列：
 * 带尾巴时步骤轨 + 焦点同行需要 ~81 列，再窄退回两行排布。
 */
const RESULT_STACK_BELOW = 82;

export interface StageBarProps {
  readonly stage: Stage;
  /** 当前聚焦的 agent，例如 `Claude Code`。 */
  readonly focus?: string;
  /** 聚焦对象的补充状态，例如 `未安装`。 */
  readonly focusNote?: string;
}

/**
 * 常驻位置层：一行回答「我在流程的哪一步、现在盯着哪个 agent」。
 * 不铺底色、不画边框——底色跟随终端原生背景，只靠字重与灰度分层；
 * 状态不只靠颜色：当前步有 ▸ 加粗、已走过的步有 ✓、右侧焦点带文字标签；
 * 结果档末尾追加「→ 选择」回环提示——接力从结果回到选择，交给下一棒。
 */
export function StageBar({ stage, focus, focusNote }: StageBarProps) {
  const currentIndex = STEPS.findIndex((step) => step.id === stage);
  const { columns } = useWindowSize();
  // 回环提示跟在步骤轨后面，64 列以下整行放不下，直接隐藏。
  const showLoop = stage === "result" && columns >= STACK_BELOW;
  const stackBelow = showLoop ? RESULT_STACK_BELOW : STACK_BELOW;
  const stacked = Boolean(focus) && columns < stackBelow;

  return (
    <Box flexDirection={stacked ? "column" : "row"} paddingX={2} marginTop={1}>
      <Box flexDirection="row">
        {STEPS.map((step, index) => (
          <Box key={step.id} flexDirection="row">
            {index > 0 ? <Text color={theme.muted}>{" › "}</Text> : null}
            {index === currentIndex ? (
              <Text bold color={theme.text}>
                {`▸ ${step.label}`}
              </Text>
            ) : index < currentIndex ? (
              <Text>
                <Text color={theme.ok}>✓ </Text>
                <Text color={theme.muted}>{step.label}</Text>
              </Text>
            ) : (
              <Text color={theme.muted}>{step.label}</Text>
            )}
          </Box>
        ))}
        {showLoop ? (
          <Text>
            <Text color={theme.muted}>{" → "}</Text>
            <Text color={theme.muted}>选择</Text>
          </Text>
        ) : null}
      </Box>
      {stacked ? null : <Box flexGrow={1} />}
      {focus ? (
        <Text>
          <Text color={FOCUS_LABEL[stage] === "当前" ? theme.brand : theme.muted}>
            {FOCUS_LABEL[stage]}
          </Text>
          <Text color={theme.muted}>{" · "}</Text>
          <Text bold color={theme.text}>
            {focus}
          </Text>
          {focusNote ? <Text color={theme.alert}>{`（${focusNote}）`}</Text> : null}
        </Text>
      ) : null}
    </Box>
  );
}
