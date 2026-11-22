import type { SessionTurn } from "../models/session";

/** 单轮输出注入上下文时保留的尾部字符数。 */
const MAX_TURN_OUTPUT_CHARS = 1_500;
/** 整段上下文的字符预算，超出的旧轮从最旧的开始丢弃。 */
const MAX_TOTAL_CONTEXT_CHARS = 8_000;

/**
 * 把历史轮次重组为一段可注入的 transcript，让任意 CLI 都能接上
 * 其他 CLI 留下的上下文——这是跨 CLI 同步的实现方式：SQLite 是
 * 唯一事实来源，prompt 层做统一回放，不依赖各 CLI 的原生会话。
 */
export function buildPromptWithContext(turns: readonly SessionTurn[], prompt: string): string {
  if (turns.length === 0) {
    return prompt;
  }

  const blocks: string[] = [];
  let total = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn) {
      continue;
    }

    const output =
      turn.output.length > MAX_TURN_OUTPUT_CHARS
        ? `…${turn.output.slice(-MAX_TURN_OUTPUT_CHARS)}`
        : turn.output;
    const ordinal = index + 1;
    const block = [
      `[#${ordinal}] 用户:`,
      turn.prompt,
      `[#${ordinal}] ${turn.cliId} 输出:`,
      output || "（无文本输出）",
    ].join("\n");

    if (total + block.length > MAX_TOTAL_CONTEXT_CHARS) {
      break;
    }
    blocks.unshift(block);
    total += block.length;
  }

  if (blocks.length === 0) {
    return prompt;
  }

  return [
    "以下是本轮任务此前的协作记录（可能由其他 agent 完成），请在此基础上继续：",
    "<context>",
    ...blocks,
    "</context>",
    "",
    "用户新请求：",
    prompt,
  ].join("\n");
}
