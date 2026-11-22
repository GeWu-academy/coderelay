import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";

import { loadConfig, resolveConfigPath, saveActivationDecisions } from "../src/config/loader";
import type { DetectedCli } from "../src/models/cli";
import { resolveRoutingMode } from "../src/router/router";
import { resolveLaunchCwd } from "../src/runtime/launcher";
import { createSessionStore, defaultSessionDbPath } from "../src/session/store";
import { App, type LaunchRequest } from "../src/ui/App";

const MOCK_CLIS: DetectedCli[] = [
  {
    id: "codex",
    bin: "codex",
    path: "/opt/bin/codex",
    version: "codex-cli 0.1.0",
    available: true,
  },
  {
    id: "claude",
    bin: "claude",
    path: "/opt/bin/claude",
    version: "claude-code 1.2.3",
    available: true,
  },
];

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Cross-workspace session store", () => {
  test("shares global SQLite database across different workspaces", async () => {
    const customHome = mkdtempSync(join(tmpdir(), "coderelay-home-"));
    try {
      const dbPath = defaultSessionDbPath(customHome);
      expect(dbPath).toBe(join(customHome, ".coderelay", "sessions.db"));

      const store = createSessionStore(dbPath);

      // Create sessions across two distinct workspaces
      const wsA = "/mock/workspace/alpha";
      const wsB = "/mock/workspace/beta";

      const sessionA = store.createSession("codex", "Alpha task 1", wsA);
      await sleep(5);
      const sessionB = store.createSession("claude", "Beta task 1", wsB);

      expect(sessionA.workspace).toBe(wsA);
      expect(sessionB.workspace).toBe(wsB);

      // Querying by workspace isolates sessions
      const sessionsA = store.listSessions({ workspace: wsA });
      expect(sessionsA).toHaveLength(1);
      expect(sessionsA[0]?.id).toBe(sessionA.id);

      const sessionsB = store.listSessions({ workspace: wsB });
      expect(sessionsB).toHaveLength(1);
      expect(sessionsB[0]?.id).toBe(sessionB.id);

      // Global query without workspace returns sessions across all workspaces
      const allSessions = store.listSessions();
      expect(allSessions).toHaveLength(2);
      expect(allSessions.map((s) => s.id)).toEqual([sessionB.id, sessionA.id]);

      store.close();
    } finally {
      rmSync(customHome, { recursive: true, force: true });
    }
  });

  test("aggregates recent workspaces across sessions ordered by latest activity", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "coderelay-recent-ws-"));
    const dbPath = join(tempDir, "sessions.db");
    const store = createSessionStore(dbPath);

    try {
      const wsA = "/project/alpha";
      const wsB = "/project/beta";
      const wsC = "/project/gamma";

      store.createSession("codex", "Task in Alpha", wsA);
      await sleep(5);
      store.createSession("claude", "Task in Beta", wsB);
      await sleep(5);
      store.createSession("codex", "Task in Gamma", wsC);
      await sleep(5);
      // Activity in Alpha again -> Alpha becomes the most recent
      store.createSession("claude", "Newer task in Alpha", wsA);

      const recent = store.getRecentWorkspaces();
      expect(recent).toEqual([wsA, wsC, wsB]);
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("attaches turns to their parent session regardless of current execution directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "coderelay-turns-ws-"));
    const dbPath = join(tempDir, "sessions.db");
    const store = createSessionStore(dbPath);

    try {
      const wsA = "/workspace/first";
      const session = store.createSession("codex", "First session", wsA);

      const turn1 = store.appendTurn({
        sessionId: session.id,
        cliId: "codex",
        prompt: "echo hello",
        output: "hello",
        exitCode: 0,
        signal: null,
        durationMs: 50,
      });

      const turns = store.listTurns(session.id);
      expect(turns).toHaveLength(1);
      expect(turns[0]?.id).toBe(turn1.id);
      expect(turns[0]?.prompt).toBe("echo hello");
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("prunes oldest sessions across all workspaces based on retention limit", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "coderelay-prune-ws-"));
    const dbPath = join(tempDir, "sessions.db");
    const store = createSessionStore(dbPath);

    try {
      const wsA = "/workspace/alpha";
      const wsB = "/workspace/beta";

      const s1 = store.createSession("codex", "Old session A", wsA);
      await sleep(5);
      const s2 = store.createSession("claude", "Session B", wsB);
      await sleep(5);
      const s3 = store.createSession("codex", "New session A", wsA);

      // Keep only 2 most recent sessions globally
      const removed = store.pruneSessions(2);
      expect(removed).toBe(1);

      // Oldest session s1 (from wsA) should be removed
      expect(store.getSession(s1.id)).toBeNull();
      expect(store.getSession(s2.id)?.id).toBe(s2.id);
      expect(store.getSession(s3.id)?.id).toBe(s3.id);

      // Workspace A now has only 1 session, Workspace B has 1 session
      expect(store.listSessions({ workspace: wsA })).toHaveLength(1);
      expect(store.listSessions({ workspace: wsB })).toHaveLength(1);
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("Cross-workspace config resolution", () => {
  test("resolves workspace-local config over global config", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "coderelay-cfg-cross-"));
    const mockHome = join(tempRoot, "home");
    const workspaceA = join(tempRoot, "ws-a");
    const workspaceB = join(tempRoot, "ws-b");

    mkdirSync(join(mockHome, ".coderelay"), { recursive: true });
    mkdirSync(join(workspaceA, ".coderelay"), { recursive: true });
    mkdirSync(workspaceB, { recursive: true });

    try {
      // Global config has routing mode: local
      writeFileSync(
        join(mockHome, ".coderelay", "config.yaml"),
        "version: 1\ndefaultAgent: codex\nrouting:\n  mode: local\n",
        "utf8",
      );

      // Workspace A has its own config with routing mode: jev
      writeFileSync(
        join(workspaceA, ".coderelay", "config.yaml"),
        "version: 1\ndefaultAgent: claude\nrouting:\n  mode: jev\n",
        "utf8",
      );

      // Workspace A resolves to workspace-local config
      const loadedA = await loadConfig({ cwd: workspaceA, homeDir: mockHome });
      expect(loadedA.config.defaultAgent).toBe("claude");
      expect(loadedA.config.routing.mode).toBe("jev");
      expect(loadedA.usedDefaults).toBe(false);
      expect(loadedA.path).toBe(join(workspaceA, ".coderelay", "config.yaml"));

      // Workspace B has no local config -> falls back to global config in mockHome
      const loadedB = await loadConfig({ cwd: workspaceB, homeDir: mockHome });
      expect(loadedB.config.defaultAgent).toBe("codex");
      expect(loadedB.config.routing.mode).toBe("local");
      expect(loadedB.usedDefaults).toBe(false);
      expect(loadedB.path).toBe(join(mockHome, ".coderelay", "config.yaml"));

      // Path resolution reflects the difference
      const pathA = await resolveConfigPath(workspaceA, mockHome);
      const pathB = await resolveConfigPath(workspaceB, mockHome);
      expect(pathA).toBe(join(workspaceA, ".coderelay", "config.yaml"));
      expect(pathB).toBe(join(mockHome, ".coderelay", "config.yaml"));
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("global activation decisions apply across workspaces lacking local config", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "coderelay-act-cross-"));
    const mockHome = join(tempRoot, "home");
    const workspace1 = join(tempRoot, "ws-1");
    const workspace2 = join(tempRoot, "ws-2");

    mkdirSync(workspace1, { recursive: true });
    mkdirSync(workspace2, { recursive: true });

    try {
      // Save global activation decision
      await saveActivationDecisions([{ cliId: "codex", enabled: false }], {
        homeDir: mockHome,
      });

      // Both workspace 1 and workspace 2 read the same global decision
      const loaded1 = await loadConfig({ cwd: workspace1, homeDir: mockHome });
      const loaded2 = await loadConfig({ cwd: workspace2, homeDir: mockHome });

      expect(loaded1.config.agents.codex?.enabled).toBe(false);
      expect(loaded2.config.agents.codex?.enabled).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("resolves routing mode dynamically when moving between workspaces", () => {
    // Workspace 1 configured with jev mode
    const modeWs1 = resolveRoutingMode("jev", null);
    expect(modeWs1).toBe("jev");

    // Workspace 2 configured with local mode
    const modeWs2 = resolveRoutingMode("local", null);
    expect(modeWs2).toBe("local");

    // User override takes precedence regardless of workspace
    const overridden = resolveRoutingMode("jev", "local");
    expect(overridden).toBe("local");
  });
});

describe("Cross-workspace execution directory resolution", () => {
  test("resolves launch cwd to the specified workspace path", () => {
    const wsPath = "/custom/target/workspace";
    const resolved = resolveLaunchCwd(wsPath, { runtime: "local", path: "/bin/codex" });
    expect(resolved).toBe(wsPath);
  });
});

describe("Cross-workspace navigation in App TUI", () => {
  test("resolves relative path navigation from active workspace", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "coderelay-cross-nav-"));
    const dirA = join(baseDir, "workspace-a");
    const dirB = join(baseDir, "workspace-b");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });

    try {
      let currentActiveWorkspace: string | undefined;
      const instance = render(
        <App
          clis={MOCK_CLIS}
          initialId="codex"
          workspace={dirA}
          onWorkspaceChange={(dir) => {
            currentActiveWorkspace = dir;
          }}
          onLaunch={() => {}}
          onExit={() => {}}
        />,
      );

      // Advance through picker to chat
      instance.stdin.write("\r");
      await nextTick();
      instance.stdin.write("\r");
      await nextTick();

      // Navigate relatively to sibling workspace ../workspace-b
      instance.stdin.write("/cd ../workspace-b");
      await nextTick();
      instance.stdin.write("\r");
      await nextTick();

      expect(currentActiveWorkspace).toBe(dirB);
      const frame = instance.lastFrame() ?? "";
      expect(frame).toContain("工作区已切换为");
      expect(frame).toContain(dirB);

      instance.cleanup();
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("handles tilde expansion and quoted workspace paths with spaces", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "coderelay-space-ws-"));
    const dirWithSpaces = join(baseDir, "my space project");
    mkdirSync(dirWithSpaces, { recursive: true });

    try {
      let currentActiveWorkspace: string | undefined;
      const instance = render(
        <App
          clis={MOCK_CLIS}
          initialId="codex"
          workspace={baseDir}
          onWorkspaceChange={(dir) => {
            currentActiveWorkspace = dir;
          }}
          onLaunch={() => {}}
          onExit={() => {}}
        />,
      );

      // Advance through picker to chat
      instance.stdin.write("\r");
      await nextTick();
      instance.stdin.write("\r");
      await nextTick();

      // Switch to directory with quotes and spaces
      instance.stdin.write(`/workspace "${dirWithSpaces}"`);
      await nextTick();
      instance.stdin.write("\r");
      await nextTick();

      expect(currentActiveWorkspace).toBe(dirWithSpaces);
      expect(instance.lastFrame() ?? "").toContain("工作区已切换为");

      // Switch using ~ (home directory)
      instance.stdin.write("/cd ~");
      await nextTick();
      instance.stdin.write("\r");
      await nextTick();

      expect(currentActiveWorkspace).toBe(resolve(homedir()));
      expect(instance.lastFrame() ?? "").toContain(resolve(homedir()));

      instance.cleanup();
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("sequential multi-step cross-workspace transitions maintain correct state", async () => {
    const root = mkdtempSync(join(tmpdir(), "coderelay-seq-ws-"));
    const ws1 = join(root, "ws-1");
    const ws2 = join(root, "ws-2");
    const ws3 = join(root, "ws-3");
    mkdirSync(ws1, { recursive: true });
    mkdirSync(ws2, { recursive: true });
    mkdirSync(ws3, { recursive: true });

    try {
      const history: string[] = [];
      const launched: LaunchRequest[] = [];
      const instance = render(
        <App
          clis={MOCK_CLIS}
          initialId="codex"
          workspace={ws1}
          onWorkspaceChange={(dir) => {
            history.push(dir);
          }}
          onLaunch={(req) => {
            launched.push(req);
          }}
          onExit={() => {}}
        />,
      );

      // Enter chat
      instance.stdin.write("\r");
      await nextTick();
      instance.stdin.write("\r");
      await nextTick();

      // Hop 1: ws1 -> ws2
      instance.stdin.write(`/workspace ${ws2}`);
      await nextTick();
      instance.stdin.write("\r");
      await nextTick();

      // Hop 2: ws2 -> ws3
      instance.stdin.write(`/cd ${ws3}`);
      await nextTick();
      instance.stdin.write("\r");
      await nextTick();

      // Query current workspace
      instance.stdin.write("/workspace");
      await nextTick();
      instance.stdin.write("\r");
      await nextTick();

      expect(history).toEqual([ws2, ws3]);
      expect(instance.lastFrame() ?? "").toContain(`当前工作区：${ws3}`);

      // Submitting prompt in the newly switched workspace triggers launch
      instance.stdin.write("fix tests in ws-3");
      await nextTick();
      instance.stdin.write("\r");
      await nextTick();

      expect(launched).toHaveLength(1);
      expect(launched[0]).toEqual({
        id: "codex",
        mode: "prompt",
        prompt: "fix tests in ws-3",
      });

      instance.cleanup();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("switching workspace creates distinct sessions per workspace in SQLite store", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "coderelay-session-iso-"));
    const dbPath = join(tempDir, "sessions.db");
    const store = createSessionStore(dbPath);

    try {
      const wsA = "/project/workspace-a";
      const wsB = "/project/workspace-b";

      // User starts in wsA and runs prompt 1
      let currentSessionId: string | null = null;
      let currentWorkspace = wsA;

      // First prompt in wsA creates session in wsA
      const sessionA = store.createSession("codex", "prompt in A", currentWorkspace);
      currentSessionId = sessionA.id;
      store.appendTurn({
        sessionId: currentSessionId,
        cliId: "codex",
        prompt: "prompt in A",
        output: "result A",
        exitCode: 0,
        signal: null,
        durationMs: 100,
      });

      // User changes workspace to wsB -> session resets
      currentWorkspace = wsB;
      currentSessionId = null;

      // Next prompt in wsB creates a new session in wsB
      const sessionB = store.createSession("codex", "prompt in B", currentWorkspace);
      currentSessionId = sessionB.id;
      store.appendTurn({
        sessionId: currentSessionId,
        cliId: "codex",
        prompt: "prompt in B",
        output: "result B",
        exitCode: 0,
        signal: null,
        durationMs: 100,
      });

      // Verify sessions are completely separated across workspaces
      expect(sessionA.id).not.toBe(sessionB.id);
      expect(sessionA.workspace).toBe(wsA);
      expect(sessionB.workspace).toBe(wsB);

      const sessionsInA = store.listSessions({ workspace: wsA });
      expect(sessionsInA).toHaveLength(1);
      expect(sessionsInA[0]?.id).toBe(sessionA.id);

      const sessionsInB = store.listSessions({ workspace: wsB });
      expect(sessionsInB).toHaveLength(1);
      expect(sessionsInB[0]?.id).toBe(sessionB.id);
    } finally {
      store.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
