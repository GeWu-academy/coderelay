import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FOLDER_STYLE_IDS } from "../../types";
import {
  FOLDER_SEMANTIC_KINDS,
  FOLDER_SEMANTIC_TABLE,
  isFolderSemanticKind,
  resolveFolderSemanticKind,
  SemanticFolderIcon,
} from "./folderStyles";

describe("folderStyles semantic resolution & rendering", () => {
  it("maintains SSOT for FOLDER_SEMANTIC_KINDS, isFolderSemanticKind, and non-empty metadata", () => {
    for (const kind of FOLDER_SEMANTIC_KINDS) {
      expect(isFolderSemanticKind(kind)).toBe(true);
      const meta = FOLDER_SEMANTIC_TABLE[kind];
      expect(meta.kind).toBe(kind);
      expect(meta.colorClass.trim().length).toBeGreaterThan(0);
      expect(meta.icon).toBeDefined();
      if (kind !== "default") {
        expect(meta.aliases.length).toBeGreaterThan(0);
      }
    }

    // Boundary & invalid values
    expect(isFolderSemanticKind("")).toBe(false);
    expect(isFolderSemanticKind("APPS")).toBe(false);
    expect(isFolderSemanticKind("unknown")).toBe(false);
    expect(isFolderSemanticKind(null)).toBe(false);
    expect(isFolderSemanticKind(undefined)).toBe(false);
    expect(isFolderSemanticKind(42)).toBe(false);
  });

  it("resolves semantic folder kinds for exact, case-insensitive, and compound directory names", () => {
    expect(resolveFolderSemanticKind("apps")).toBe("apps");
    expect(resolveFolderSemanticKind("changes")).toBe("changes");
    expect(resolveFolderSemanticKind("deploy")).toBe("deploy");
    expect(resolveFolderSemanticKind("docs")).toBe("docs");
    expect(resolveFolderSemanticKind("tooling")).toBe("tooling");
    expect(resolveFolderSemanticKind("src")).toBe("src");
    expect(resolveFolderSemanticKind("packages")).toBe("packages");
    expect(resolveFolderSemanticKind("components")).toBe("components");
    expect(resolveFolderSemanticKind("routes")).toBe("routes");
    expect(resolveFolderSemanticKind("stores")).toBe("stores");
    expect(resolveFolderSemanticKind("utils")).toBe("utils");
    expect(resolveFolderSemanticKind("tests")).toBe("tests");
    expect(resolveFolderSemanticKind("config")).toBe("config");
    expect(resolveFolderSemanticKind("assets")).toBe("assets");
    expect(resolveFolderSemanticKind("scripts")).toBe("scripts");
    expect(resolveFolderSemanticKind("styles")).toBe("styles");
    expect(resolveFolderSemanticKind("api")).toBe("api");
    expect(resolveFolderSemanticKind("security")).toBe("security");
    expect(resolveFolderSemanticKind("dist")).toBe("build");

    // Case-insensitive & compound names
    expect(resolveFolderSemanticKind("DOCS")).toBe("docs");
    expect(resolveFolderSemanticKind("  src-tauri  ")).toBe("src");
    expect(resolveFolderSemanticKind("e2e_tests")).toBe("tests");
    expect(resolveFolderSemanticKind("API-Server")).toBe("api");

    // Boundary & unmatched values fall back to default
    expect(resolveFolderSemanticKind("")).toBe("default");
    expect(resolveFolderSemanticKind("   ")).toBe("default");
    expect(resolveFolderSemanticKind("my-custom-folder")).toBe("default");
  });

  it("renders SemanticFolderIcon accurately for clean and personalized folder presets", () => {
    const cleanHtml = renderToStaticMarkup(
      <SemanticFolderIcon name="deploy" isExpanded={false} styleId="clean" />,
    );
    expect(cleanHtml).toContain('data-folder-style="clean"');
    expect(cleanHtml).toContain('data-folder-semantic="default"');
    expect(cleanHtml).toContain("text-muted-strong");
    expect(cleanHtml).not.toContain("text-orange-600");

    const cleanExpandedHtml = renderToStaticMarkup(
      <SemanticFolderIcon name="deploy" isExpanded={true} styleId="clean" />,
    );
    expect(cleanExpandedHtml).toContain("text-ink");

    const semanticColorHtml = renderToStaticMarkup(
      <SemanticFolderIcon name="deploy" isExpanded={false} styleId="semantic-color" />,
    );
    expect(semanticColorHtml).toContain('data-folder-style="semantic-color"');
    expect(semanticColorHtml).toContain('data-folder-semantic="deploy"');
    expect(semanticColorHtml).toContain("text-orange-600");

    const semanticMonoHtml = renderToStaticMarkup(
      <SemanticFolderIcon name="docs" isExpanded={false} styleId="semantic-mono" />,
    );
    expect(semanticMonoHtml).toContain('data-folder-style="semantic-mono"');
    expect(semanticMonoHtml).toContain('data-folder-semantic="docs"');
    expect(semanticMonoHtml).toContain("text-muted-strong");
    expect(semanticMonoHtml).not.toContain("text-purple-600");

    const tintedHtml = renderToStaticMarkup(
      <SemanticFolderIcon name="tooling" isExpanded={true} styleId="tinted-folder" />,
    );
    expect(tintedHtml).toContain('data-folder-style="tinted-folder"');
    expect(tintedHtml).toContain('data-folder-semantic="tooling"');
    expect(tintedHtml).toContain("text-amber-600");

    // Ensure every preset ID renders a valid SVG
    for (const styleId of FOLDER_STYLE_IDS) {
      const svgHtml = renderToStaticMarkup(
        <SemanticFolderIcon name="apps" isExpanded={false} styleId={styleId} />,
      );
      expect(svgHtml).toContain("<svg");
      expect(svgHtml).toContain(`data-folder-style="${styleId}"`);
    }
  });
});
