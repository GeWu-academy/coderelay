export interface SlashCommand {
  readonly name: string;
  readonly description: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "/mode", description: "切换决策模式 (local / manual / jev)" },
  { name: "/favorite", description: "设置最喜欢的初始化 agent (持久化到 SQLite)" },
  { name: "/model", description: "切换 agent，会话上下文保留" },
  { name: "/workspace", description: "切换或查看当前工作区路径 (/cd 别名)" },
  { name: "/cd", description: "切换工作区路径 (/workspace 别名)" },
  { name: "/activate", description: "启用或禁用 CLI，保存到配置" },
  { name: "/new", description: "开始新会话，清空上下文" },
  { name: "/help", description: "显示可用命令" },
];

export const SLASH_HELP = SLASH_COMMANDS.map(
  (command) => `${command.name} ${command.description}`,
).join(" · ");

/** 当前输入命中的命令（用于输入 `/` 时的实时菜单）。 */
export function matchSlashCommands(input: string): readonly SlashCommand[] {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return [];
  }
  const cmd = trimmed.split(/\s+/)[0] ?? "";
  const exact = SLASH_COMMANDS.find((command) => command.name === cmd);
  if (exact) {
    return [exact];
  }
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(cmd));
}

/** 精确匹配一条命令；找不到返回 undefined。 */
export function findSlashCommand(input: string): SlashCommand | undefined {
  const trimmed = input.trim();
  const cmd = trimmed.split(/\s+/)[0] ?? "";
  return SLASH_COMMANDS.find((command) => command.name === cmd);
}
