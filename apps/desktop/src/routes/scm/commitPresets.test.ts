import { describe, expect, it } from "bun:test";

import {
  applyCommitTypePrefix,
  COMMIT_MESSAGE_PRESETS,
  COMMIT_TYPE_PRESETS,
  COMMIT_TYPES,
  detectCommitType,
  isCommitType,
} from "./commitPresets";

describe("commitPresets", () => {
  it("keeps COMMIT_TYPE_PRESETS and COMMIT_MESSAGE_PRESETS consistent with COMMIT_TYPES", () => {
    expect(COMMIT_TYPE_PRESETS.map((item) => item.type)).toEqual([...COMMIT_TYPES]);
    for (const preset of COMMIT_TYPE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
    expect(COMMIT_MESSAGE_PRESETS.length).toBeGreaterThan(0);
    for (const preset of COMMIT_MESSAGE_PRESETS) {
      expect(isCommitType(preset.type)).toBe(true);
      expect(detectCommitType(preset.message)).toBe(preset.type);
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it("validates commit types with isCommitType", () => {
    expect(isCommitType("feat")).toBe(true);
    expect(isCommitType("fix")).toBe(true);
    expect(isCommitType("refactor")).toBe(true);
    expect(isCommitType("unknown")).toBe(false);
    expect(isCommitType("")).toBe(false);
    expect(isCommitType(123)).toBe(false);
    expect(isCommitType(null)).toBe(false);
  });

  it("detects commit type from conventional commit messages", () => {
    expect(detectCommitType("feat: 新增提交快捷前缀")).toBe("feat");
    expect(detectCommitType("  fix(scm): 修复列表刷新问题")).toBe("fix");
    expect(detectCommitType("refactor(core)!: 调整状态结构")).toBe("refactor");
    expect(detectCommitType("custom: 自定义前缀")).toBeNull();
    expect(detectCommitType("直接写提交信息")).toBeNull();
    expect(detectCommitType("")).toBeNull();
  });

  it("applies or replaces commit type prefix while preserving scope and body", () => {
    expect(applyCommitTypePrefix("", "feat")).toBe("feat: ");
    expect(applyCommitTypePrefix("   ", "fix")).toBe("fix: ");
    expect(applyCommitTypePrefix("支持快捷预设", "feat")).toBe("feat: 支持快捷预设");
    expect(applyCommitTypePrefix("fix: 支持快捷预设", "refactor")).toBe("refactor: 支持快捷预设");
    expect(applyCommitTypePrefix("feat(scm)!: 支持快捷预设", "fix")).toBe(
      "fix(scm)!: 支持快捷预设",
    );
    expect(applyCommitTypePrefix("foo: 保留非标准前缀", "docs")).toBe("docs: foo: 保留非标准前缀");
  });
});
