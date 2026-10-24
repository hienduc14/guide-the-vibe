// Language registry: file extension -> tree-sitter grammar + extraction rules.
// Supported: TypeScript/TSX, JavaScript, Python, Go, Java.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Language, Parser, Query } from "web-tree-sitter";

export type LangId = "typescript" | "tsx" | "javascript" | "python" | "go" | "java";

const EXT: Record<string, LangId> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
};

const WASM: Record<LangId, string> = {
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
  go: "tree-sitter-go/tree-sitter-go.wasm",
  java: "tree-sitter-java/tree-sitter-java.wasm",
};

/** Queries that capture reference sites. @name = referenced identifier, @recv = receiver/object (optional). */
const JS_REFS = `
(call_expression function: (identifier) @name) @call
(call_expression function: (member_expression object: (_) @recv property: (property_identifier) @name)) @call
(new_expression constructor: (identifier) @name) @call
`;
const TS_REFS = JS_REFS + `
(type_identifier) @type
`;

const REF_QUERIES: Record<LangId, string> = {
  typescript: TS_REFS,
  tsx: TS_REFS,
  javascript: JS_REFS,
  python: `
(call function: (identifier) @name) @call
(call function: (attribute object: (_) @recv attribute: (identifier) @name)) @call
`,
  go: `
(call_expression function: (identifier) @name) @call
(call_expression function: (selector_expression operand: (_) @recv field: (field_identifier) @name)) @call
(type_identifier) @type
`,
  java: `
(method_invocation object: (_) @recv name: (identifier) @name) @call
(method_invocation !object name: (identifier) @name) @call
(object_creation_expression type: (type_identifier) @name) @call
(type_identifier) @type
`,
};

export function langForPath(path: string): LangId | undefined {
  const m = /\.[^./\\]+$/.exec(path);
  return m ? EXT[m[0].toLowerCase()] : undefined;
}

export const SUPPORTED_EXTENSIONS = Object.keys(EXT);

interface Loaded {
  language: Language;
  parser: Parser;
  refQuery: Query;
}

let initPromise: Promise<void> | undefined;
const loaded = new Map<LangId, Loaded>();
const require = createRequire(import.meta.url);

export async function loadLanguage(id: LangId): Promise<Loaded> {
  const hit = loaded.get(id);
  if (hit) return hit;
  initPromise ??= Parser.init();
  await initPromise;
  const language = await Language.load(readFileSync(require.resolve(WASM[id])));
  const parser = new Parser();
  parser.setLanguage(language);
  const refQuery = new Query(language, REF_QUERIES[id]);
  const entry = { language, parser, refQuery };
  loaded.set(id, entry);
  return entry;
}
