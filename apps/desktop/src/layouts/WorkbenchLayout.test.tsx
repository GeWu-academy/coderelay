import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { useNavigationStore } from "../stores/navigationStore";
import { useWorkbenchStore } from "../stores/workbenchStore";
import type { AgentEntry } from "../types";
import { WorkbenchLayout } from "./WorkbenchLayout";

describe("WorkbenchLayout", () => {
  it("renders all decoupled component slots uniformly when conversation route and bottom dock are active", () => {
    const html = renderToStaticMarkup(
      <WorkbenchLayout
        view="workspace"
        showLeftSidebar={true}
        sidebarCollapsed={false}
        rightSidebarOpen={true}
        showBottomDock={true}
        customBackground="data:image/png;base64,abc123"
        customBackgroundOpacity={0.35}
        titlebar={<header data-testid="slot-titlebar">TitlebarSlot</header>}
        iconRail={<nav data-testid="slot-icon-rail">IconRailSlot</nav>}
        leftSidebar={<aside data-testid="slot-left-sidebar">LeftSidebarSlot</aside>}
        main={<section data-testid="slot-main">MainViewSlot</section>}
        bottomDock={<div data-testid="slot-bottom-dock">BottomDockSlot</div>}
        rightSidebar={<aside data-testid="slot-right-sidebar">RightSidebarSlot</aside>}
      />,
    );

    expect(html).toContain('data-testid="custom-background-layer"');
    expect(html).toContain("opacity:0.35");
    expect(html).toContain("TitlebarSlot");
    expect(html).toContain("IconRailSlot");
    expect(html).toContain("LeftSidebarSlot");
    expect(html).toContain("MainViewSlot");
    expect(html).toContain("BottomDockSlot");
    expect(html).toContain("RightSidebarSlot");
    expect(html).toContain('data-view="workspace"');
    expect(html).toContain('data-sidebar-collapsed="false"');
    expect(html).toContain('data-right-sidebar-open="true"');
  });

  it("omits leftSidebar, bottomDock, and background layer when disabled by layout props", () => {
    const html = renderToStaticMarkup(
      <WorkbenchLayout
        view="config"
        showLeftSidebar={false}
        sidebarCollapsed={false}
        rightSidebarOpen={false}
        showBottomDock={false}
        customBackground={null}
        titlebar={<header>TitlebarSlot</header>}
        iconRail={<nav>IconRailSlot</nav>}
        leftSidebar={<aside>LeftSidebarSlot</aside>}
        main={<section>ConfigMainSlot</section>}
        bottomDock={<div>BottomDockSlot</div>}
        rightSidebar={<aside>RightSidebarSlot</aside>}
      />,
    );

    expect(html).not.toContain('data-testid="custom-background-layer"');
    expect(html).not.toContain("LeftSidebarSlot");
    expect(html).not.toContain("BottomDockSlot");
    expect(html).toContain("ConfigMainSlot");
    expect(html).toContain('data-view="config"');
    expect(html).toContain('data-sidebar-collapsed="true"');
    expect(html).toContain('data-right-sidebar-open="false"');
  });

  it("updates cohesive workbench store state cleanly without coupling to layout", () => {
    const store = useWorkbenchStore.getState();
    const sampleAgent: AgentEntry = {
      id: "claude",
      label: "Claude Code",
      enabled: true,
      isDefault: true,
      available: true,
      command: "claude",
      path: "/usr/local/bin/claude",
      version: "2.1.0",
      models: ["claude-sonnet-4-5"],
      runtime: "native",
      source: "path",
      candidates: [],
      diagnostics: [],
    };

    useWorkbenchStore.setState({
      discovery: {
        cwd: "/Users/dev/coderelay",
        configPath: "/Users/dev/coderelay/coderelay.yaml",
        defaultAgent: "claude",
        recentWorkspaces: ["/Users/dev/coderelay"],
        routingModes: ["local", "cloud"],
        agents: [sampleAgent],
        catalog: {
          probes: [],
          options: [
            {
              cliId: "claude",
              modelId: "claude-sonnet-4-5",
              label: "Claude Sonnet 4.5",
              isDefault: true,
              capabilities: {
                structuredEvents: true,
                nativeResume: true,
                nonInteractivePrompt: true,
                explicitModel: true,
                toolEvents: true,
              },
              available: true,
              strengths: ["coding"],
            },
          ],
        },
        permissions: [
          {
            cliId: "claude",
            options: [
              {
                id: "default",
                label: "Default",
                description: "Ask before running tools",
                dangerous: false,
              },
            ],
          },
        ],
      },
      workspaceInput: "/Users/dev/coderelay",
    });

    store.setPrompt("Refactor layout architecture");
    store.setMode("cloud");
    store.selectAgent(sampleAgent);

    const updated = useWorkbenchStore.getState();
    expect(updated.form.prompt).toBe("Refactor layout architecture");
    expect(updated.form.mode).toBe("cloud");
    expect(updated.form.agent).toBe("claude");
    expect(updated.form.model).toBe("claude-sonnet-4-5");

    store.startNewTask();
    expect(useWorkbenchStore.getState().form.prompt).toBe("");
    expect(useNavigationStore.getState().view).toBe("workspace");
    expect(useNavigationStore.getState().activeSessionId).toBeNull();
  });

  it("renders expand trigger on the left when left sidebar is collapsed and hides it when expanded", () => {
    const collapsedHtml = renderToStaticMarkup(
      <WorkbenchLayout
        view="workspace"
        showLeftSidebar={true}
        sidebarCollapsed={true}
        rightSidebarOpen={false}
        showBottomDock={false}
        onExpandSidebar={() => {}}
        titlebar={<header>Titlebar</header>}
        iconRail={<nav>Rail</nav>}
        leftSidebar={<aside>Sidebar</aside>}
        main={<section>Main</section>}
        rightSidebar={<aside>Right</aside>}
      />,
    );
    expect(collapsedHtml).toContain('data-testid="sidebar-expand-trigger"');
    expect(collapsedHtml).toContain('data-sidebar-collapsed="true"');

    const expandedHtml = renderToStaticMarkup(
      <WorkbenchLayout
        view="workspace"
        showLeftSidebar={true}
        sidebarCollapsed={false}
        rightSidebarOpen={false}
        showBottomDock={false}
        onExpandSidebar={() => {}}
        titlebar={<header>Titlebar</header>}
        iconRail={<nav>Rail</nav>}
        leftSidebar={<aside>Sidebar</aside>}
        main={<section>Main</section>}
        rightSidebar={<aside>Right</aside>}
      />,
    );
    expect(expandedHtml).not.toContain('data-testid="sidebar-expand-trigger"');
    expect(expandedHtml).toContain('data-sidebar-collapsed="false"');
  });
});
