import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { JevSettings } from "../../types";
import { ApiKeyView } from "./ApiKeyView";

describe("ApiKeyView", () => {
  it("renders ApiKeyView with stored SQLite key and ensures no config yaml elements exist", () => {
    const jevSettings: JevSettings = {
      stored: true,
      environmentConfigured: false,
    };
    const html = renderToStaticMarkup(
      <ApiKeyView
        jevBusy={false}
        jevSettings={jevSettings}
        jevApiKeyInput="sk-live-real-user-test-key-12345"
        notice="API Key 已成功持久化到本地 SQLite"
        onJevApiKeyInputChange={() => {}}
        onSaveJevApiKey={() => {}}
        onClearJevApiKey={() => {}}
      />,
    );

    // Verify API Key management UI elements
    expect(html).toContain("API 密钥管理");
    expect(html).toContain("TypeSafe JEV 决策路由");
    expect(html).toContain("已存储在本地安全数据库 (SQLite)");
    expect(html).toContain("API Key 已成功持久化到本地 SQLite");
    expect(html).toContain("sk-live-real-user-test-key-12345");
    expect(html).toContain("清除已存 API Key");

    // Strictly ensure Decoupling: Config YAML elements must NOT exist in ApiKeyView
    expect(html).not.toContain("Config YAML");
    expect(html).not.toContain("textarea");
    expect(html).not.toContain("config.yaml");
  });

  it("renders ApiKeyView with environment-configured key state and unconfigured state", () => {
    const envSettings: JevSettings = {
      stored: false,
      environmentConfigured: true,
    };
    const envHtml = renderToStaticMarkup(
      <ApiKeyView
        jevBusy={false}
        jevSettings={envSettings}
        jevApiKeyInput=""
        onJevApiKeyInputChange={() => {}}
        onSaveJevApiKey={() => {}}
        onClearJevApiKey={() => {}}
      />,
    );

    expect(envHtml).toContain("已从环境变量 (TYPESAFE_API_KEY) 配置");
    expect(envHtml).not.toContain("清除已存 API Key");

    const unconfiguredSettings: JevSettings = {
      stored: false,
      environmentConfigured: false,
    };
    const unconfHtml = renderToStaticMarkup(
      <ApiKeyView
        jevBusy={false}
        jevSettings={unconfiguredSettings}
        jevApiKeyInput=""
        onJevApiKeyInputChange={() => {}}
        onSaveJevApiKey={() => {}}
        onClearJevApiKey={() => {}}
      />,
    );

    expect(unconfHtml).toContain("未配置");
    expect(unconfHtml).toContain("填入 TYPESAFE_API_KEY");
  });
});
