import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CODE_THEME_PRESETS } from "../../types";
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

    // Verify Code Color Style options and live code snippet previews
    expect(html).toContain("代码颜色风格");
    expect(html).toContain("GitHub Light");
    expect(html).toContain("One Dark");
    expect(html).toContain("Dracula");
    expect(html).toContain("Tokyo Night");
    expect(html).toContain("// 语法高亮示例");
    expect(html).toContain("greet");
    for (const preset of CODE_THEME_PRESETS) {
      expect(html).toContain(`data-code-theme-option="${preset.id}"`);
      expect(html).toContain(preset.subtitle);
      if (preset.id !== "auto") {
        expect(html).toContain(`background-color:${preset.palette.background}`);
        expect(html).toContain(`color:${preset.palette.keyword}`);
      }
    }

    // Verify Folder Style options
    expect(html).toContain("文件夹样式");
    expect(html).toContain("极简干净");

    // Ensure verbose style descriptions have been removed for compact layout
    expect(html).not.toContain("模 ChatGPT 多风格配色预设");
    expect(html).not.toContain("ChatGPT 经典纯白，明亮开阔");
    expect(html).not.toContain("支持上传本地图片作为沉浸背景");
    expect(html).not.toContain("代码文件浏览器的语法高亮配色");
    expect(html).not.toContain("文件浏览器目录语义图标与风格预设");

    // Verify Folder Semantic Style preset options
    expect(html).toContain("文件夹样式");
    expect(html).toContain("极简干净");
    expect(html).toContain("语义彩色");
    expect(html).toContain("语义单色");
    expect(html).toContain("色标文件夹");
    expect(html).toContain('data-folder-style="semantic-color"');

    // Strictly ensure Decoupling: API Key elements must NOT be coupled into ConfigView
    expect(html).not.toContain("API Key");
    expect(html).not.toContain("jev-api-key");
    expect(html).not.toContain("TYPESAFE_API_KEY");
    expect(html).not.toContain("API 密钥管理");
  });
});
