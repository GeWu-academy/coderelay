import type { GitSortMode, GitStatusEntry } from "../../types";

export interface ScmTreeFolderNode {
  kind: "folder";
  key: string;
  name: string;
  path: string;
  children: ScmTreeNode[];
}

export interface ScmTreeFileNode {
  kind: "file";
  key: string;
  name: string;
  path: string;
  entry: GitStatusEntry;
}

export type ScmTreeNode = ScmTreeFolderNode | ScmTreeFileNode;

export function splitPathParts(filePath: string): { name: string; dir: string } {
  const slashIdx = filePath.lastIndexOf("/");
  if (slashIdx === -1) {
    return { name: filePath, dir: "" };
  }
  return {
    name: filePath.slice(slashIdx + 1),
    dir: filePath.slice(0, slashIdx),
  };
}

function statusSortRank(entry: GitStatusEntry, staged: boolean): number {
  if (entry.conflicted) {
    return 0;
  }
  if (entry.untracked && !staged) {
    return 5;
  }
  const code = staged ? entry.indexStatus : entry.worktreeStatus;
  switch (code) {
    case "A":
      return 1;
    case "M":
      return 2;
    case "R":
      return 3;
    case "D":
      return 4;
    default:
      return 6;
  }
}

export function sortGitEntries(
  entries: readonly GitStatusEntry[],
  mode: GitSortMode,
  staged: boolean,
): GitStatusEntry[] {
  const copy = [...entries];
  copy.sort((a, b) => {
    if (mode === "status") {
      const rankDiff = statusSortRank(a, staged) - statusSortRank(b, staged);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return a.path.localeCompare(b.path);
    }
    if (mode === "name") {
      const nameA = splitPathParts(a.path).name;
      const nameB = splitPathParts(b.path).name;
      const nameDiff = nameA.localeCompare(nameB);
      if (nameDiff !== 0) {
        return nameDiff;
      }
      return a.path.localeCompare(b.path);
    }
    return a.path.localeCompare(b.path);
  });
  return copy;
}

interface MutableFolder {
  name: string;
  path: string;
  folders: Map<string, MutableFolder>;
  files: ScmTreeFileNode[];
}

function finalizeFolder(
  folder: MutableFolder,
  mode: GitSortMode,
  staged: boolean,
): ScmTreeNode[] {
  const folderNodes: ScmTreeFolderNode[] = [];
  for (const child of folder.folders.values()) {
    let compactedName = child.name;
    let compactedPath = child.path;
    let cursor = child;
    while (cursor.folders.size === 1 && cursor.files.length === 0) {
      const onlyChild = cursor.folders.values().next().value;
      if (!onlyChild) {
        break;
      }
      compactedName = `${compactedName}/${onlyChild.name}`;
      compactedPath = onlyChild.path;
      cursor = onlyChild;
    }
    folderNodes.push({
      kind: "folder",
      key: `folder:${compactedPath}`,
      name: compactedName,
      path: compactedPath,
      children: finalizeFolder(cursor, mode, staged),
    });
  }
  folderNodes.sort((a, b) => a.name.localeCompare(b.name));

  const sortedEntries = sortGitEntries(
    folder.files.map((f) => f.entry),
    mode,
    staged,
  );
  const fileMap = new Map(folder.files.map((f) => [f.path, f]));
  const fileNodes: ScmTreeFileNode[] = [];
  for (const entry of sortedEntries) {
    const node = fileMap.get(entry.path);
    if (node) {
      fileNodes.push(node);
    }
  }

  return [...folderNodes, ...fileNodes];
}

export function buildGitEntryTree(
  entries: readonly GitStatusEntry[],
  mode: GitSortMode,
  staged: boolean,
): ScmTreeNode[] {
  const root: MutableFolder = {
    name: "",
    path: "",
    folders: new Map(),
    files: [],
  };

  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }
    let current = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i]!;
      const nextPath = current.path ? `${current.path}/${seg}` : seg;
      let child = current.folders.get(seg);
      if (!child) {
        child = {
          name: seg,
          path: nextPath,
          folders: new Map(),
          files: [],
        };
        current.folders.set(seg, child);
      }
      current = child;
    }
    const fileName = segments[segments.length - 1]!;
    current.files.push({
      kind: "file",
      key: `file:${entry.path}`,
      name: fileName,
      path: entry.path,
      entry,
    });
  }

  return finalizeFolder(root, mode, staged);
}
