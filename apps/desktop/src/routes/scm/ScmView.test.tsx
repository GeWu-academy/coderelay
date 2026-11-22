import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { IconRail } from "../../components";
import { ScmOutputPanel } from "./ScmOutputPanel";
import { ScmView } from "./ScmView";

describe("ScmView", () => {
  it("renders Source Control route in IconRail and ScmView with workspace, more menu trigger & empty state", () => {
    const railHtml = renderToStaticMarkup(
      <IconRail currentView="scm" onSelectView={() => {}} />,
    );
    expect(railHtml).toContain('aria-label="Source Control"');
    expect(railHtml).toContain("源码");

    const scmHtml = renderToStaticMarkup(
      <ScmView
        workspaceInput="/Users/allure/Desktop/coderelay"
        selectedAgentId="codex"
        selectedModelId="gpt-5.4"
        onPickWorkspace={() => {}}
      />,
    );
    expect(scmHtml).toContain("coderelay");
    expect(scmHtml).toContain("源代码管理");
    expect(scmHtml).toContain('aria-label="更多 Git 操作"');
    expect(scmHtml).toContain("在左侧选择任意变更文件以查看 Diff 对比");

    const emptyScmHtml = renderToStaticMarkup(
      <ScmView workspaceInput="" onPickWorkspace={() => {}} />,
    );
    expect(emptyScmHtml).toContain("尚未选择工作区");
    expect(emptyScmHtml).toContain("选择工作区目录");
  });

  it("renders ScmOutputPanel with recorded git commands and exit codes", () => {
    const html = renderToStaticMarkup(
      <ScmOutputPanel
        entries={[
          {
            id: 1,
            timestampMs: 1763700000000,
            cwd: "/Users/allure/Desktop/coderelay",
            command: "git fetch --prune",
            exitCode: 0,
            stdout: "From github.com:google/coderelay",
            stderr: "",
          },
          {
            id: 2,
            timestampMs: 1763700005000,
            cwd: "/Users/allure/Desktop/coderelay",
            command: "git merge origin/main",
            exitCode: 1,
            stdout: "",
            stderr: "CONFLICT (content): Merge conflict in src/App.tsx",
          },
        ]}
        loading={false}
        onClear={() => {}}
        onClose={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(html).toContain("Git 输出");
    expect(html).toContain("git fetch --prune");
    expect(html).toContain("exit 0");
    expect(html).toContain("git merge origin/main");
    expect(html).toContain("exit 1");
    expect(html).toContain("Merge conflict in src/App.tsx");
  });
});
