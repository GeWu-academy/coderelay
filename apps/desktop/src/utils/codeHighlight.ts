import type { CodeThemePalette } from "../types";

export type CodeTokenType =
  "plain" | "keyword" | "string" | "comment" | "number" | "type" | "func" | "operator" | "property";

export interface CodeToken {
  readonly text: string;
  readonly type: CodeTokenType;
}

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "py",
  "go",
  "java",
  "kt",
  "kts",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "cs",
  "swift",
  "rb",
  "php",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "css",
  "scss",
  "less",
  "html",
  "xml",
  "svg",
  "md",
  "mdx",
  "sh",
  "bash",
  "zsh",
  "fish",
  "sql",
  "lua",
]);

const HASH_COMMENT_EXTENSIONS = new Set([
  "py",
  "rb",
  "sh",
  "bash",
  "zsh",
  "fish",
  "yaml",
  "yml",
  "toml",
]);

const DASH_COMMENT_EXTENSIONS = new Set(["sql", "lua"]);

const KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "crate",
  "default",
  "def",
  "defer",
  "delete",
  "do",
  "elif",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "fn",
  "for",
  "from",
  "func",
  "function",
  "go",
  "if",
  "impl",
  "import",
  "in",
  "interface",
  "is",
  "let",
  "loop",
  "match",
  "mod",
  "mut",
  "new",
  "nil",
  "none",
  "None",
  "not",
  "null",
  "or",
  "package",
  "pass",
  "pub",
  "raise",
  "readonly",
  "ref",
  "return",
  "self",
  "Self",
  "select",
  "static",
  "struct",
  "super",
  "switch",
  "this",
  "throw",
  "trait",
  "true",
  "True",
  "False",
  "try",
  "type",
  "typeof",
  "undefined",
  "use",
  "var",
  "void",
  "where",
  "while",
  "with",
  "yield",
]);

const PRIMITIVE_TYPES = new Set([
  "any",
  "bigint",
  "bool",
  "boolean",
  "byte",
  "char",
  "double",
  "f32",
  "f64",
  "float",
  "i8",
  "i16",
  "i32",
  "i64",
  "i128",
  "int",
  "isize",
  "never",
  "number",
  "object",
  "str",
  "string",
  "symbol",
  "u8",
  "u16",
  "u32",
  "u64",
  "u128",
  "unknown",
  "usize",
]);

function isWordStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$";
}

function isWordChar(ch: string): boolean {
  return isWordStart(ch) || (ch >= "0" && ch <= "9");
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isOperatorChar(ch: string): boolean {
  return "+-*/%=<>!&|^~?:".includes(ch);
}

function pushToken(tokens: CodeToken[], text: string, type: CodeTokenType): void {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.type === type) {
    tokens[tokens.length - 1] = { text: last.text + text, type };
  } else {
    tokens.push({ text, type });
  }
}

function scanQuotedString(line: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) {
      return i + 1;
    }
    i += 1;
  }
  return line.length;
}

/**
 * Tokenize source code lines into syntax-highlighted token arrays while
 * preserving multi-line block comment state across lines.
 */
export function tokenizeCodeLines(
  lines: readonly string[],
  extension: string | null,
): CodeToken[][] {
  const ext = extension?.toLowerCase() ?? null;
  if (!ext || !CODE_EXTENSIONS.has(ext)) {
    return lines.map((line) => (line ? [{ text: line, type: "plain" }] : []));
  }

  const useHashComment = HASH_COMMENT_EXTENSIONS.has(ext);
  const useDashComment = DASH_COMMENT_EXTENSIONS.has(ext);
  const isJsonLike = ext === "json" || ext === "jsonc";
  const isYamlLike = ext === "yaml" || ext === "yml" || ext === "toml";

  let inBlockComment = false;
  const result: CodeToken[][] = [];

  for (const line of lines) {
    const tokens: CodeToken[] = [];
    let i = 0;

    while (i < line.length) {
      if (inBlockComment) {
        const endIdx = line.indexOf("*/", i);
        if (endIdx === -1) {
          pushToken(tokens, line.slice(i), "comment");
          i = line.length;
        } else {
          pushToken(tokens, line.slice(i, endIdx + 2), "comment");
          inBlockComment = false;
          i = endIdx + 2;
        }
        continue;
      }

      const ch = line.charAt(i);
      const next = line.charAt(i + 1);

      // Line comments
      if (ch === "/" && next === "/") {
        pushToken(tokens, line.slice(i), "comment");
        break;
      }
      if (useHashComment && ch === "#") {
        pushToken(tokens, line.slice(i), "comment");
        break;
      }
      if (useDashComment && ch === "-" && next === "-") {
        pushToken(tokens, line.slice(i), "comment");
        break;
      }

      // Block comment start
      if (ch === "/" && next === "*") {
        const endIdx = line.indexOf("*/", i + 2);
        if (endIdx === -1) {
          pushToken(tokens, line.slice(i), "comment");
          inBlockComment = true;
          break;
        }
        pushToken(tokens, line.slice(i, endIdx + 2), "comment");
        i = endIdx + 2;
        continue;
      }

      // Strings
      if (ch === '"' || ch === "'" || ch === "`") {
        const endIdx = scanQuotedString(line, i, ch);
        const literal = line.slice(i, endIdx);
        // Detect JSON / object property keys: "key":
        let lookAhead = endIdx;
        while (lookAhead < line.length && line.charAt(lookAhead) === " ") {
          lookAhead += 1;
        }
        const isPropKey = isJsonLike && line.charAt(lookAhead) === ":";
        pushToken(tokens, literal, isPropKey ? "property" : "string");
        i = endIdx;
        continue;
      }

      // Numbers
      if (isDigit(ch) || (ch === "." && isDigit(next))) {
        let endIdx = i + 1;
        while (endIdx < line.length && /[0-9a-fA-FxXbBoO._]/.test(line.charAt(endIdx))) {
          endIdx += 1;
        }
        pushToken(tokens, line.slice(i, endIdx), "number");
        i = endIdx;
        continue;
      }

      // Identifiers, keywords, types, functions, properties
      if (isWordStart(ch)) {
        let endIdx = i + 1;
        while (endIdx < line.length && isWordChar(line.charAt(endIdx))) {
          endIdx += 1;
        }
        const word = line.slice(i, endIdx);

        let lookAhead = endIdx;
        while (lookAhead < line.length && line.charAt(lookAhead) === " ") {
          lookAhead += 1;
        }
        const afterChar = line.charAt(lookAhead);

        let tokenType: CodeTokenType = "plain";
        const firstWordChar = word.charAt(0);
        if (KEYWORDS.has(word)) {
          tokenType = "keyword";
        } else if (PRIMITIVE_TYPES.has(word)) {
          tokenType = "type";
        } else if (afterChar === "(") {
          tokenType = "func";
        } else if (isYamlLike && afterChar === ":") {
          tokenType = "property";
        } else if (firstWordChar >= "A" && firstWordChar <= "Z" && /[a-z]/.test(word)) {
          tokenType = "type";
        }

        pushToken(tokens, word, tokenType);
        i = endIdx;
        continue;
      }

      // Operators
      if (isOperatorChar(ch)) {
        let endIdx = i + 1;
        while (endIdx < line.length && isOperatorChar(line.charAt(endIdx))) {
          endIdx += 1;
        }
        pushToken(tokens, line.slice(i, endIdx), "operator");
        i = endIdx;
        continue;
      }

      // Whitespace and punctuation
      pushToken(tokens, ch, "plain");
      i += 1;
    }

    result.push(tokens);
  }

  return result;
}

/**
 * Resolve the display color for a syntax token under the given palette.
 */
export function tokenColor(type: CodeTokenType, palette: CodeThemePalette): string {
  switch (type) {
    case "keyword":
      return palette.keyword;
    case "string":
      return palette.string;
    case "comment":
      return palette.comment;
    case "number":
      return palette.number;
    case "type":
      return palette.type;
    case "func":
      return palette.func;
    case "operator":
      return palette.operator;
    case "property":
      return palette.property;
    case "plain":
    default:
      return palette.foreground;
  }
}
