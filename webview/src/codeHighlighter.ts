export type CodeTokenKind = "plain" | "comment" | "string" | "number" | "keyword";

export interface CodeToken {
  readonly kind: CodeTokenKind;
  readonly value: string;
}

const maximumHighlightedCharacters = 50_000;
const keywords = new Set([
  "abstract",
  "async",
  "await",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "def",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "static",
  "string",
  "struct",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const tokenPattern =
  /\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|#[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b|\b[A-Za-z_]\w*\b/gi;

export function tokenizeCode(code: string): readonly CodeToken[] {
  if (code.length === 0) {
    return [];
  }
  if (code.length > maximumHighlightedCharacters) {
    return [{ kind: "plain", value: code }];
  }

  const tokens: CodeToken[] = [];
  let cursor = 0;
  for (const match of code.matchAll(tokenPattern)) {
    const value = match[0];
    const index = match.index;
    if (index > cursor) {
      tokens.push({ kind: "plain", value: code.slice(cursor, index) });
    }
    tokens.push({ kind: classify(value), value });
    cursor = index + value.length;
  }
  if (cursor < code.length) {
    tokens.push({ kind: "plain", value: code.slice(cursor) });
  }
  return tokens;
}

function classify(value: string): CodeTokenKind {
  if (value.startsWith("//") || value.startsWith("/*") || value.startsWith("#")) {
    return "comment";
  }
  if (value.startsWith('"') || value.startsWith("'") || value.startsWith("`")) {
    return "string";
  }
  if (/^(?:0x[\da-f]+|\d)/i.test(value)) {
    return "number";
  }
  return keywords.has(value.toLocaleLowerCase()) ? "keyword" : "plain";
}
