import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkspaceView } from "./WorkspaceView";

describe("WorkspaceView", () => {
  it("separates inline and structured thinking from visible output in WorkspaceView", () => {
    const html = renderToStaticMarkup(
      <WorkspaceView
        error={null}
        showThread
        running={false}
        result={null}
        preview={null}
        thinking="Structured thought line"
        output={"<thinking>Inline thought line</thinking>\nFinal visible answer"}
        activity={[]}
        renderComposer={() => <div />}
      />,
    );

    expect(html).toContain('data-testid="thinking-bar"');
    expect(html).toContain('data-expanded="false"');
    expect(html).toContain("Final visible answer");
    expect(html).not.toContain("<thinking>");
    expect(html).not.toContain("Structured thought line");
  });
});
