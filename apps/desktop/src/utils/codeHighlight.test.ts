import { describe, expect, it } from "bun:test";
import { getCodeThemePalette } from "../stores/themeStore";
import { tokenColor, tokenizeCodeLines } from "./codeHighlight";

describe("codeHighlight syntax tokenizer", () => {
  it("tokenizes TypeScript keywords, types, functions, strings, numbers, and comments", () => {
    const lines = [
      "// greeting helper",
      'const count: number = computeTotal("items", 42);',
    ];
    const tokenized = tokenizeCodeLines(lines, "ts");

    expect(tokenized).toHaveLength(2);
    expect(tokenized[0]).toEqual([
      { text: "// greeting helper", type: "comment" },
    ]);

    const line2 = tokenized[1] ?? [];
    expect(line2.some((t) => t.text === "const" && t.type === "keyword")).toBe(true);
    expect(line2.some((t) => t.text === "number" && t.type === "type")).toBe(true);
    expect(line2.some((t) => t.text === "computeTotal" && t.type === "func")).toBe(true);
    expect(line2.some((t) => t.text === '"items"' && t.type === "string")).toBe(true);
    expect(line2.some((t) => t.text === "42" && t.type === "number")).toBe(true);
  });

  it("tracks multi-line block comments across lines", () => {
    const lines = [
      "/* start comment",
      "   still inside comment */ const x = 1;",
    ];
    const tokenized = tokenizeCodeLines(lines, "rs");
    const line2 = tokenized[1] ?? [];

    expect(tokenized[0]).toEqual([
      { text: "/* start comment", type: "comment" },
    ]);
    expect(line2[0]).toEqual({
      text: "   still inside comment */",
      type: "comment",
    });
    expect(
      line2.some((t) => t.text === "const" && t.type === "keyword"),
    ).toBe(true);
  });

  it("supports hash comments in Python/YAML and property keys in JSON", () => {
    const py = tokenizeCodeLines(["# config", 'name = "relay"'], "py");
    expect(py[0]).toEqual([{ text: "# config", type: "comment" }]);
    expect((py[1] ?? []).some((t) => t.text === '"relay"' && t.type === "string")).toBe(true);

    const json = tokenizeCodeLines(['  "timeoutMs": 3000'], "json");
    const jsonLine = json[0] ?? [];
    expect(
      jsonLine.some((t) => t.text === '"timeoutMs"' && t.type === "property"),
    ).toBe(true);
    expect(jsonLine.some((t) => t.text === "3000" && t.type === "number")).toBe(true);
  });

  it("falls back to plain tokens for unknown or null extensions", () => {
    const plain = tokenizeCodeLines(["hello world", ""], null);
    expect(plain).toEqual([[{ text: "hello world", type: "plain" }], []]);

    const txt = tokenizeCodeLines(["const x = 1;"], "txt");
    expect(txt).toEqual([[{ text: "const x = 1;", type: "plain" }]]);
  });

  it("maps every token type to a non-empty color from the active palette", () => {
    const palette = getCodeThemePalette("one-dark");
    expect(tokenColor("keyword", palette)).toBe(palette.keyword);
    expect(tokenColor("string", palette)).toBe(palette.string);
    expect(tokenColor("comment", palette)).toBe(palette.comment);
    expect(tokenColor("number", palette)).toBe(palette.number);
    expect(tokenColor("type", palette)).toBe(palette.type);
    expect(tokenColor("func", palette)).toBe(palette.func);
    expect(tokenColor("operator", palette)).toBe(palette.operator);
    expect(tokenColor("property", palette)).toBe(palette.property);
    expect(tokenColor("plain", palette)).toBe(palette.foreground);
  });
});
