import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ConfigView } from "./ConfigView";

describe("ConfigView", () => {
  it("renders ConfigView focused solely on config YAML settings without any API key coupling", () => {
    const sampleConfigPath = "/home/developer/.coderelay/config.yaml";
    const sampleConfigDraft = [
      "routing:",
      "  mode: dynamic",
      "  fallbackAgent: claude",
      "  timeoutMs: 30000",
    ].join("\n");

    const html = renderToStaticMarkup(
      <ConfigView
        configPath={sampleConfigPath}
        configBusy={false}
        configDraft={sampleConfigDraft}
        onConfigDraftChange={() => {}}
        onLoadConfigSource={() => {}}
        onSaveConfig={() => {}}
      />,
    );

    // Verify Config UI elements
    expect(html).toContain(sampleConfigPath);
    expect(html).toContain("Config YAML");
    expect(html).toContain("fallbackAgent: claude");

    // Verify Theme Preset options including newly added themes
    expect(html).toContain("主题外观");
    expect(html).toContain("青色");
    expect(html).toContain("天蓝色");
    expect(html).toContain("粉色");
    expect(html).toContain("红色");
    expect(html).toContain("自定义背景图");
    expect(html).toContain("上传背景图片文件");

    // Verify Code Color Style options
    expect(html).toContain("代码颜色风格");
    expect(html).toContain("GitHub Light");
    expect(html).toContain("One Dark");
    expect(html).toContain("Dracula");
    expect(html).toContain("Tokyo Night");

    // Strictly ensure Decoupling: API Key elements must NOT be coupled into ConfigView
    expect(html).not.toContain("API Key");
    expect(html).not.toContain("jev-api-key");
    expect(html).not.toContain("TYPESAFE_API_KEY");
    expect(html).not.toContain("API 密钥管理");
  });
});
