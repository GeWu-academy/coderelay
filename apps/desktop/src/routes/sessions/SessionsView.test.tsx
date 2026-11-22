import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CLI_IDS, type SessionRecord } from "../../types";
import { groupSessionsByCli, SessionsView } from "./SessionsView";

const SAMPLE_SESSIONS: SessionRecord[] = [
  {
    id: "sess-claude-old",
    cliId: "CLAUDE",
    title: "重构会话路由布局",
    createdAt: 1732100000000,
    updatedAt: 1732100500000,
    workspace: "/Users/dev/coderelay",
  },
  {
    id: "sess-claude-new",
    cliId: "claude",
    title: "修复暗色主题边框对比度",
    createdAt: 1732101000000,
    updatedAt: 1732109000000,
    workspace: "/Users/dev/Hearo",
  },
  {
    id: "sess-codex-1",
    cliId: " codex ",
    title: "排查 Tauri 打包签名问题",
    createdAt: 1732102000000,
    updatedAt: 1732108000000,
    workspace: "/Users/dev/coderelay",
  },
  {
    id: "sess-pi-1",
    cliId: "pi",
    title: "编写单测断言边界值",
    createdAt: 1732103000000,
    updatedAt: 1732107000000,
  },
  {
    id: "sess-unknown",
    cliId: "gemini",
    title: "非固定 CLI 记录应被过滤",
    createdAt: 1732104000000,
    updatedAt: 1732106000000,
    workspace: "/Users/dev/other",
  },
];

describe("groupSessionsByCli", () => {
  it("always returns the 4 fixed CLI workspaces in CLI_IDS order and sorts each bucket by updatedAt desc", () => {
    const groups = groupSessionsByCli(SAMPLE_SESSIONS);

    expect(groups.map((item) => item.cliId)).toEqual([...CLI_IDS]);

    const codex = groups.find((item) => item.cliId === "codex");
    const claude = groups.find((item) => item.cliId === "claude");
    const pi = groups.find((item) => item.cliId === "pi");
    const omp = groups.find((item) => item.cliId === "omp");

    expect(codex?.totalCount).toBe(1);
    expect(codex?.sessions.map((s) => s.id)).toEqual(["sess-codex-1"]);

    expect(claude?.totalCount).toBe(2);
    expect(claude?.sessions.map((s) => s.id)).toEqual(["sess-claude-new", "sess-claude-old"]);

    expect(pi?.totalCount).toBe(1);
    expect(pi?.sessions.map((s) => s.id)).toEqual(["sess-pi-1"]);

    expect(omp?.totalCount).toBe(0);
    expect(omp?.sessions).toEqual([]);
  });

  it("filters sessions by title or workspace while preserving per-CLI totalCount", () => {
    const byWorkspace = groupSessionsByCli(SAMPLE_SESSIONS, "hearo");
    const claude = byWorkspace.find((item) => item.cliId === "claude");
    const codex = byWorkspace.find((item) => item.cliId === "codex");

    expect(claude?.totalCount).toBe(2);
    expect(claude?.sessions.map((s) => s.id)).toEqual(["sess-claude-new"]);
    expect(codex?.totalCount).toBe(1);
    expect(codex?.sessions).toEqual([]);

    const byTitle = groupSessionsByCli(SAMPLE_SESSIONS, "tauri");
    expect(byTitle.find((item) => item.cliId === "codex")?.sessions.map((s) => s.id)).toEqual([
      "sess-codex-1",
    ]);
  });
});

describe("SessionsView", () => {
  it("renders all 4 fixed CLI workspaces with overflow-hidden bounds, counts, and session metadata", () => {
    const html = renderToStaticMarkup(
      <SessionsView
        workspaceInput="/Users/dev/Hearo"
        sessions={SAMPLE_SESSIONS}
        activeSessionId="sess-claude-new"
        onRefreshSessions={() => {}}
        onOpenSession={() => {}}
      />,
    );

    for (const cliId of CLI_IDS) {
      expect(html).toContain(`data-cli-workspace="${cliId}"`);
      expect(html).toContain(`data-cli-count="${cliId}"`);
    }

    expect(html).toContain("overflow-hidden");
    expect(html).toContain("Hearo");
    expect(html).toContain("4 条");
    expect(html).toContain("修复暗色主题边框对比度");
    expect(html).toContain("排查 Tauri 打包签名问题");
    expect(html).toContain("编写单测断言边界值");
    expect(html).toContain("暂无会话记录");
    expect(html).not.toContain("非固定 CLI 记录应被过滤");
  });
});
