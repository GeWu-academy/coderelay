import { isAgentId } from "../agents/registry";
import { CLI_IDS, type CliId } from "../models/cli";
import {
  createSessionStore,
  defaultSessionDbPath,
  type SessionStore,
} from "../session/store";

export const AGENT_LABELS: Readonly<Record<CliId, string>> = {
  codex: "Codex",
  claude: "Claude Code",
  pi: "Pi",
  omp: "OMP",
};

export interface FavoriteCommandOptions {
  readonly agent?: string;
  readonly homeDir?: string;
}

export interface FavoriteCommandDependencies {
  readonly store?: SessionStore;
  readonly write?: (text: string) => void;
}

/**
 * Manage user's favorite initial agent stored in SQLite.
 * Returns process exit code (0 for success, 1 for invalid input).
 */
export async function runFavoriteCommand(
  options: FavoriteCommandOptions = {},
  dependencies: FavoriteCommandDependencies = {},
): Promise<number> {
  const write = dependencies.write ?? ((text: string) => process.stdout.write(text));
  const store =
    dependencies.store ??
    createSessionStore(defaultSessionDbPath(options.homeDir));

  try {
    const rawAgent = options.agent?.trim().toLowerCase();

    if (!rawAgent) {
      const current = store.getFavoriteAgent();
      if (current) {
        write(`当前最喜欢的初始化 agent: ${AGENT_LABELS[current]} (${current})\n`);
      } else {
        write(
          `尚未设置最喜欢的初始化 agent。\n使用 'coderelay favorite <agent>' 设置偏好 (支持: ${CLI_IDS.join(", ")})。\n`,
        );
      }
      return 0;
    }

    if (rawAgent === "clear" || rawAgent === "none") {
      store.clearFavoriteAgent();
      write("✓ 已清除最喜欢的初始化 agent 偏好。\n");
      return 0;
    }

    if (!isAgentId(rawAgent)) {
      write(
        `× 无效的 agent: "${rawAgent}"。支持的 agent: ${CLI_IDS.join(", ")}\n`,
      );
      return 1;
    }

    store.setFavoriteAgent(rawAgent);
    write(
      `✓ 已将 ${AGENT_LABELS[rawAgent]} (${rawAgent}) 设为最喜欢的初始化 agent，已持久化到 SQLite。\n`,
    );
    return 0;
  } finally {
    if (!dependencies.store) {
      store.close();
    }
  }
}
