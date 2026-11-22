import { describe, expect, it } from "bun:test";

import type { GitStatusEntry } from "../../types";
import { buildGitEntryTree, sortGitEntries, splitPathParts } from "./scmTree";

const SAMPLE_ENTRIES: GitStatusEntry[] = [
  {
    path: "src/routes/scm/ScmView.tsx",
    origPath: null,
    indexStatus: "M",
    worktreeStatus: "M",
    staged: true,
    unstaged: true,
    untracked: false,
    conflicted: false,
  },
  {
    path: "src/routes/scm/scmTree.ts",
    origPath: null,
    indexStatus: "?",
    worktreeStatus: "?",
    staged: false,
    unstaged: false,
    untracked: true,
    conflicted: false,
  },
  {
    path: "apps/desktop/App.tsx",
    origPath: null,
    indexStatus: "A",
    worktreeStatus: ".",
    staged: true,
    unstaged: false,
    untracked: false,
    conflicted: false,
  },
  {
    path: "README.md",
    origPath: null,
    indexStatus: ".",
    worktreeStatus: "D",
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
  },
  {
    path: "src/conflict.ts",
    origPath: null,
    indexStatus: "U",
    worktreeStatus: "U",
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: true,
  },
];

describe("scmTree", () => {
  it("splits path into filename and directory", () => {
    expect(splitPathParts("src/routes/scm/ScmView.tsx")).toEqual({
      name: "ScmView.tsx",
      dir: "src/routes/scm",
    });
    expect(splitPathParts("README.md")).toEqual({
      name: "README.md",
      dir: "",
    });
  });

  it("sorts entries by name, path, and status", () => {
    const byName = sortGitEntries(SAMPLE_ENTRIES, "name", false).map((e) => e.path);
    expect(byName).toEqual([
      "apps/desktop/App.tsx",
      "src/conflict.ts",
      "README.md",
      "src/routes/scm/scmTree.ts",
      "src/routes/scm/ScmView.tsx",
    ]);

    const byPath = sortGitEntries(SAMPLE_ENTRIES, "path", false).map((e) => e.path);
    expect(byPath).toEqual([
      "apps/desktop/App.tsx",
      "README.md",
      "src/conflict.ts",
      "src/routes/scm/scmTree.ts",
      "src/routes/scm/ScmView.tsx",
    ]);

    const byStatus = sortGitEntries(SAMPLE_ENTRIES, "status", false).map((e) => e.path);
    expect(byStatus[0]).toBe("src/conflict.ts");
    expect(byStatus[1]).toBe("src/routes/scm/ScmView.tsx");
    expect(byStatus[2]).toBe("README.md");
    expect(byStatus[3]).toBe("src/routes/scm/scmTree.ts");
  });

  it("builds a compacted directory tree with folders before files", () => {
    const tree = buildGitEntryTree(SAMPLE_ENTRIES, "path", false);
    expect(tree.map((n) => `${n.kind}:${n.name}`)).toEqual([
      "folder:apps/desktop",
      "folder:src",
      "file:README.md",
    ]);

    const srcNode = tree[1];
    expect(srcNode?.kind).toBe("folder");
    if (srcNode?.kind === "folder") {
      expect(srcNode.children.map((n) => `${n.kind}:${n.name}`)).toEqual([
        "folder:routes/scm",
        "file:conflict.ts",
      ]);
      const scmNode = srcNode.children[0];
      expect(scmNode?.kind).toBe("folder");
      if (scmNode?.kind === "folder") {
        expect(scmNode.children.map((n) => n.name)).toEqual([
          "scmTree.ts",
          "ScmView.tsx",
        ]);
      }
    }
  });
});
