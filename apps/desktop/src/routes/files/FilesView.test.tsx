import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { IconRail, Sidebar } from "../../components";
import { closeFileTab, FilesView } from "./FilesView";

describe("FilesView", () => {
  it("renders Files route in IconRail and VS Code-style Explorer in FilesView without embedded workspace wheel", () => {
    const railHtml = renderToStaticMarkup(
      <IconRail currentView="files" onSelectView={() => {}} />,
    );
    expect(railHtml).toContain('aria-label="Files"');

    const filesHtml = renderToStaticMarkup(
      <FilesView
        workspaceInput="/Users/allure/Desktop/coderelay"
        onPickWorkspace={() => {}}
      />,
    );
    expect(filesHtml).toContain("Explorer");
    expect(filesHtml).not.toContain("Workspace wheel switcher");
    expect(filesHtml).toContain("coderelay");
    expect(filesHtml).toContain('placeholder="Filter files..."');
    expect(filesHtml).toContain("Select a file from the explorer sidebar");
  });

  it("manages VS Code-style multi-file tabs and closes individual files cleanly", () => {
    const tabs = ["src/App.tsx", "src/main.ts", "README.md"];

    // Closing an inactive tab keeps the current active tab
    const afterInactiveClose = closeFileTab(tabs, "src/main.ts", "src/App.tsx");
    expect(afterInactiveClose.nextTabs).toEqual(["src/main.ts", "README.md"]);
    expect(afterInactiveClose.nextActiveTab).toBe("src/main.ts");

    // Closing the active middle tab activates the next tab
    const afterActiveClose = closeFileTab(tabs, "src/main.ts", "src/main.ts");
    expect(afterActiveClose.nextTabs).toEqual(["src/App.tsx", "README.md"]);
    expect(afterActiveClose.nextActiveTab).toBe("README.md");

    // Closing the active last tab falls back to the previous tab
    const afterLastClose = closeFileTab(tabs, "README.md", "README.md");
    expect(afterLastClose.nextTabs).toEqual(["src/App.tsx", "src/main.ts"]);
    expect(afterLastClose.nextActiveTab).toBe("src/main.ts");

    // Closing the only remaining tab resets activeTab to null
    const afterFinalClose = closeFileTab(["README.md"], "README.md", "README.md");
    expect(afterFinalClose.nextTabs).toEqual([]);
    expect(afterFinalClose.nextActiveTab).toBeNull();
  });

  it("leaves workspace empty without showing home directory when no folder is selected", () => {
    const emptyFilesHtml = renderToStaticMarkup(
      <FilesView
        workspaceInput=""
        onPickWorkspace={() => {}}
      />,
    );
    expect(emptyFilesHtml).toContain("未选择文件夹");
    expect(emptyFilesHtml).toContain("Open a folder to browse and inspect its files.");
    expect(emptyFilesHtml).not.toContain("Remove workspace");

    const emptySidebarHtml = renderToStaticMarkup(
      <Sidebar
        workspaceInput=""
        recentWorkspaces={[]}
        workspaceDropdownOpen={false}
        onToggleWorkspaceDropdown={() => {}}
        onSelectWorkspace={() => {}}
        onPickWorkspace={() => {}}
        loading={false}
        onRefreshDiscovery={() => {}}
        onStartNewTask={() => {}}
        sessions={[]}
        activeSessionId={null}
        onOpenSession={() => {}}
        onDeleteSession={() => {}}
        onDeleteWorkspaceSessions={() => {}}
      />,
    );
    expect(emptySidebarHtml).toContain("选择文件夹");
  });
});
