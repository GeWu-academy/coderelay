export interface CommitTypePreset {
  readonly type: CommitType;
  readonly label: string;
  readonly description: string;
}

export const COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "docs",
  "style",
  "perf",
  "test",
  "chore",
] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

export function isCommitType(val: unknown): val is CommitType {
  return (COMMIT_TYPES as readonly unknown[]).includes(val);
}

export const COMMIT_TYPE_PRESETS: readonly CommitTypePreset[] = [
  { type: "feat", label: "feat", description: "新增功能" },
  { type: "fix", label: "fix", description: "修复缺陷" },
  { type: "refactor", label: "refactor", description: "代码重构" },
  { type: "docs", label: "docs", description: "文档更新" },
  { type: "style", label: "style", description: "样式与格式" },
  { type: "perf", label: "perf", description: "性能优化" },
  { type: "test", label: "test", description: "补充测试" },
  { type: "chore", label: "chore", description: "构建与杂项" },
] as const;

export interface CommitMessagePreset {
  readonly id: string;
  readonly label: string;
  readonly type: CommitType;
  readonly message: string;
}

export const COMMIT_MESSAGE_PRESETS: readonly CommitMessagePreset[] = [
  {
    id: "fix-bug",
    label: "修复问题",
    type: "fix",
    message: "fix: 修复已知问题",
  },
  {
    id: "refactor-code",
    label: "优化结构",
    type: "refactor",
    message: "refactor: 优化代码结构",
  },
  {
    id: "style-ui",
    label: "样式调整",
    type: "style",
    message: "style: 调整页面样式与格式",
  },
  {
    id: "docs-update",
    label: "更新文档",
    type: "docs",
    message: "docs: 更新文档说明",
  },
  {
    id: "chore-deps",
    label: "更新依赖",
    type: "chore",
    message: "chore: 更新依赖与配置",
  },
  {
    id: "chore-wip",
    label: "暂存进度",
    type: "chore",
    message: "chore: wip 暂存开发进度",
  },
] as const;

const COMMIT_PREFIX_PATTERN = /^([a-z]+)(\([^)]*\))?(!)?:\s*/;

export function detectCommitType(message: string): CommitType | null {
  const match = COMMIT_PREFIX_PATTERN.exec(message.trimStart());
  if (!match) {
    return null;
  }
  const candidate = match[1];
  return isCommitType(candidate) ? candidate : null;
}

export function applyCommitTypePrefix(currentMessage: string, nextType: CommitType): string {
  const trimmedStart = currentMessage.trimStart();
  const match = COMMIT_PREFIX_PATTERN.exec(trimmedStart);
  if (match && isCommitType(match[1])) {
    const scope = match[2] ?? "";
    const breaking = match[3] ?? "";
    const rest = trimmedStart.slice(match[0].length);
    return `${nextType}${scope}${breaking}: ${rest}`;
  }
  if (!trimmedStart) {
    return `${nextType}: `;
  }
  return `${nextType}: ${trimmedStart}`;
}
