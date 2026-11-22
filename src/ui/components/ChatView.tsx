import { TextInput } from "@inkjs/ui";
import { Box, Text, useWindowSize } from "ink";
import { useEffect, useRef, useState } from "react";

import type { SessionTurn } from "../../models/session";
import { theme } from "../theme";
import { cliDisplayName } from "./CliList";

/** 对话板内最多渲染的轮数，长会话只保留结尾。 */
const TURN_TAIL = 8;
/** 每轮输出最多渲染的行数。 */
const TURN_OUTPUT_LINES = 3;
/** 等待动画：粒子蛇沿响应式轨道往返，不表达真实进度。 */
const WAIT_SNAKE_MIN_CELLS = 10;
const WAIT_SNAKE_MAX_CELLS = 32;
const WAIT_SNAKE_RESERVED_COLUMNS = 36;
const WAIT_SNAKE_FPS = 8;
const WAIT_SNAKE_PARTICLES = ["◆", "●", "•", "·"] as const;
const WAIT_SNAKE_COLOR = theme.accent;
/** CLI 回复正文统一使用主文字色。 */
const CLI_RESPONSE_COLOR = theme.text;

export interface RunningState {
  readonly agentName: string;
  readonly prompt: string;
  readonly startedAt: number;
  readonly modelId?: string;
  readonly liveText?: string;
  readonly statusText?: string;
  readonly tool?: string;
}

export interface SlashCommandOption {
  readonly name: string;
  readonly description: string;
}

export interface ChatViewProps {
  readonly agentName: string;
  readonly turns: readonly SessionTurn[];
  readonly running: RunningState | null;
  readonly prompt: string;
  readonly notice: string | null;
  readonly commands: readonly SlashCommandOption[];
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
}

function useElapsedSeconds(startedAt: number | null): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0);
      return;
    }

    const tick = () => {
      setElapsed(Math.max(0, (Date.now() - startedAt) / 1000));
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => {
      clearInterval(timer);
    };
  }, [startedAt]);

  return elapsed;
}

function waitingSnakeCells(columns: number): number {
  return Math.max(
    WAIT_SNAKE_MIN_CELLS,
    Math.min(WAIT_SNAKE_MAX_CELLS, columns - WAIT_SNAKE_RESERVED_COLUMNS),
  );
}

function waitingSnakeFrame(elapsed: number, cells: number): string {
  const firstHead = WAIT_SNAKE_PARTICLES.length - 1;
  const lastHead = cells - 1;
  const span = lastHead - firstHead;
  const phase = Math.floor(elapsed * WAIT_SNAKE_FPS) % (span * 2);
  const movingRight = phase <= span;
  const head = movingRight ? firstHead + phase : lastHead - (phase - span);
  const track = Array.from({ length: cells }, () => " ");

  WAIT_SNAKE_PARTICLES.forEach((particle, offset) => {
    const position = movingRight ? head - offset : head + offset;
    if (position >= 0 && position < cells) {
      track[position] = particle;
    }
  });

  return track.join("");
}

function WaitingSnake({
  elapsed,
  columns,
}: {
  readonly elapsed: number;
  readonly columns: number;
}) {
  return (
    <Text bold color={WAIT_SNAKE_COLOR}>
      {waitingSnakeFrame(elapsed, waitingSnakeCells(columns))}
    </Text>
  );
}

function TurnBlock({ turn }: { readonly turn: SessionTurn }) {
  const failed = turn.signal !== null || (turn.exitCode !== null && turn.exitCode !== 0);
  const outputText = turn.output.trim() ? turn.output : "";
  const lines = outputText
    ? outputText.replace(/\s+$/, "").split("\n").slice(-TURN_OUTPUT_LINES)
    : [];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box width="100%" justifyContent="flex-end">
        <Text>
          <Text bold color={theme.accent}>
            ❯{" "}
          </Text>
          <Text color={theme.text} wrap="truncate-end">
            {turn.prompt}
          </Text>
        </Text>
      </Box>
      {lines.map((line, index) => (
        <Text key={index} color={CLI_RESPONSE_COLOR} wrap="truncate-end">
          {line === "" ? " " : line}
        </Text>
      ))}
      <Box width="100%" justifyContent="flex-end">
        <Text color={failed ? theme.alert : theme.muted}>
          {`${failed ? "×" : "✓"} ${cliDisplayName(turn.cliId)}${turn.modelId ? `:${turn.modelId}` : ""} · exit ${turn.exitCode ?? "—"} · ${(turn.durationMs / 1_000).toFixed(1)}s`}
          {turn.signal ? ` · ${turn.signal}` : ""}
          {turn.contextSource === "native"
            ? " · 原生会话"
            : turn.contextSource === "transcript"
              ? " · transcript 上下文"
              : ""}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * 对话区：不铺底色、不画边框，底色跟随终端原生背景——
 * 多轮对话按顺序往下排，输入框常驻在末尾，一轮结束立刻回到可输入状态；
 * running 时输入框保留但禁用。
 */
export function ChatView({
  agentName,
  turns,
  running,
  prompt,
  notice,
  commands,
  onChange,
  onSubmit,
}: ChatViewProps) {
  const elapsed = useElapsedSeconds(running?.startedAt ?? null);
  const [submitNonce, setSubmitNonce] = useState(0);
  const lastSubmittedRef = useRef<string | null>(null);
  // TextInput 非受控：挂载时捕获一次种子值，之后内部状态是唯一事实，
  // 重挂载（key 变化）永远从空串开始，避免与父组件的清空 setState 竞态。
  const [initialPrompt] = useState(prompt);
  const { columns } = useWindowSize();
  const tail = turns.slice(-TURN_TAIL);
  const idle = running === null;

  const handleChange = (value: string): void => {
    // 提交后 React 会补发一条「提交前最后一次输入」的过期 onChange
    // （passive effect 晚于提交刷新），吞掉它，防止把父组件刚清空的
    // prompt / notice 写回旧值。
    if (lastSubmittedRef.current !== null && value === lastSubmittedRef.current) {
      return;
    }
    lastSubmittedRef.current = null;
    onChange(value);
  };

  const handleSubmit = (value: string): void => {
    lastSubmittedRef.current = value;
    // TextInput 非受控，重挂载才能清空输入框。
    setSubmitNonce((nonce) => nonce + 1);
    onSubmit(value);
  };

  return (
    <Box flexDirection="column" paddingX={2}>
      {tail.length > 0 ? (
        <Text color={theme.muted}>{`会话 · ${turns.length} 轮`}</Text>
      ) : (
        <>
          <Text>
            <Text color={theme.muted}>将任务交给 </Text>
            <Text bold color={theme.text}>
              {agentName}
            </Text>
          </Text>
          <Text color={theme.muted}>写清目标和完成标准，接力会更稳。输入 / 查看命令。</Text>
        </>
      )}

      {tail.map((turn) => (
        <TurnBlock key={turn.id} turn={turn} />
      ))}

      {running ? (
        <>
          {running.liveText ? (
            <Box flexDirection="column" marginTop={1}>
              {running.liveText
                .replace(/\s+$/, "")
                .split("\n")
                .slice(-6)
                .map((line, index) => (
                  <Text key={index} color={CLI_RESPONSE_COLOR} wrap="truncate-end">
                    {line === "" ? " " : line}
                  </Text>
                ))}
            </Box>
          ) : null}
          {running.statusText ? (
            <Box marginTop={1}>
              <Text color={theme.muted}>{running.statusText}</Text>
            </Box>
          ) : null}
          {running.tool ? (
            <Box>
              <Text color={theme.muted}>{`正在执行工具：${running.tool}`}</Text>
            </Box>
          ) : null}
          <Box flexDirection="row" marginTop={tail.length > 0 ? 1 : 0}>
            <WaitingSnake elapsed={elapsed} columns={columns} />
            <Text> </Text>
            <Text>
              <Text color={theme.muted}>等待 </Text>
              <Text bold color={theme.text}>
                {running.agentName}
              </Text>
              <Text color={theme.muted}> 的回复…</Text>
            </Text>
            <Text bold color={theme.accent}>
              {` ${elapsed.toFixed(1)}s`}
            </Text>
          </Box>
          <Box width="100%" justifyContent="flex-end">
            <Text color={theme.muted} wrap="truncate-end">
              {running.prompt}
            </Text>
          </Box>
        </>
      ) : null}

      {commands.map((command) => (
        <Text key={command.name}>
          <Text bold color={theme.accent}>
            {command.name}
          </Text>
          <Text color={theme.muted}>{`  ${command.description}`}</Text>
        </Text>
      ))}
      {notice ? <Text color={theme.muted}>{notice}</Text> : null}

      <Box marginTop={1}>
        <Text color={theme.muted}>{"─".repeat(Math.max(8, columns - 4))}</Text>
      </Box>

      <Box flexDirection="row">
        <Text bold={idle} color={idle ? theme.accent : theme.muted}>
          {"❯ "}
        </Text>
        <TextInput
          key={submitNonce}
          defaultValue={initialPrompt}
          placeholder="写下任务，/ 查看命令…"
          onChange={handleChange}
          onSubmit={handleSubmit}
          isDisabled={!idle}
        />
      </Box>
    </Box>
  );
}
