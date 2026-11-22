import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ThinkingBar } from "./ThinkingBar";

describe("ThinkingBar", () => {
  it("renders ThinkingBar as a single collapsed line by default and reveals detail only when expanded", () => {
    const thinking = "Step 1: inspect event parser\nStep 2: verify UI output";

    const collapsedHtml = renderToStaticMarkup(<ThinkingBar thinking={thinking} />);
    expect(collapsedHtml).toContain('data-testid="thinking-bar"');
    expect(collapsedHtml).toContain('data-expanded="false"');
    expect(collapsedHtml).toContain("Thinking");
    expect(collapsedHtml).toContain("2L");
    expect(collapsedHtml).toContain("Step 2: verify UI output");
    expect(collapsedHtml).not.toContain('data-testid="thinking-detail"');
    expect(collapsedHtml).not.toContain("Step 1: inspect event parser");

    const expandedHtml = renderToStaticMarkup(<ThinkingBar thinking={thinking} defaultExpanded />);
    expect(expandedHtml).toContain('data-expanded="true"');
    expect(expandedHtml).toContain('data-testid="thinking-detail"');
    expect(expandedHtml).toContain("Step 1: inspect event parser");
    expect(expandedHtml).toContain("Step 2: verify UI output");
  });
});
