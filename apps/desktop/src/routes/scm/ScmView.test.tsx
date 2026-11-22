import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { IconRail } from "../../components";
import { ScmView } from "./ScmView";

describe("ScmView", () => {
  it("renders Source Control route in IconRail and ScmView with workspace & empty state", () => {
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
    expect(scmHtml).toContain("在左侧选择任意变更文件以查看 Diff 对比");

    const emptyScmHtml = renderToStaticMarkup(
      <ScmView workspaceInput="" onPickWorkspace={() => {}} />,
    );
    expect(emptyScmHtml).toContain("尚未选择工作区");
    expect(emptyScmHtml).toContain("选择工作区目录");
  });
});
