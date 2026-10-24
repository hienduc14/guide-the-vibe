// One parse per file -> symbols (with signature/body hashes), reference sites and imports.
// The same output feeds the code graph and the L2 symbol-conflict detector.

import type { Node } from "web-tree-sitter";
import { langForPath, loadLanguage, type LangId } from "./languages.ts";
import { shortHash, normPath } from "../shared/util.ts";

export type SymbolKind = "function" | "method" | "constructor" | "class" | "interface" | "type" | "enum" | "struct";

export interface SymbolDef {
  id: string; // `${file}#${qualname}`
  file: string;
  name: string;
  qualname: string;
  kind: SymbolKind;
  start_line: number;
  end_line: number;
  sig: string;
  sig_hash: string;
  body_hash: string;
  exported: boolean;
}

export interface RefSite {
  file: string;
  name: string;
  line: number;
  kind: "call" | "type";
  recv?: string;
  from_symbol?: string;
}

export interface ImportSite {
  file: string;
  source: string;
  names: string[];
}

export interface FileIndex {
  path: string;
  lang: LangId;
  content_hash: string;
  has_errors: boolean;
  symbols: SymbolDef[];
  refs: RefSite[];
  imports: ImportSite[];
}

const CONTAINER_KINDS = new Set<SymbolKind>(["class", "interface", "struct", "enum"]);

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

interface DefInfo {
  kind: SymbolKind;
  nameNode: Node | null;
  name?: string;
  body: Node | null;
  /** Use the whole node text as the signature (contracts such as interfaces/types). */
  wholeIsSig?: boolean;
  qualPrefix?: string;
  exported?: boolean;
}

function header(node: Node, body: Node | null): string {
  if (!body) return squash(node.text);
  return squash(node.text.slice(0, body.startIndex - node.startIndex));
}

function isExportedJs(node: Node): boolean {
  let p = node.parent;
  for (let i = 0; p && i < 3; i++, p = p.parent) {
    if (p.type === "export_statement") return true;
    if (p.type === "program" || p.type === "class_body" || p.type === "statement_block") return false;
  }
  return false;
}

function jsDef(node: Node, inContainer: boolean): DefInfo | null {
  switch (node.type) {
    case "function_declaration":
    case "generator_function_declaration":
    case "function_signature":
      return { kind: "function", nameNode: node.childForFieldName("name"), body: node.childForFieldName("body"), exported: isExportedJs(node) };
    case "class_declaration":
    case "abstract_class_declaration":
      return { kind: "class", nameNode: node.childForFieldName("name"), body: node.childForFieldName("body"), exported: isExportedJs(node) };
    case "interface_declaration":
      return { kind: "interface", nameNode: node.childForFieldName("name"), body: node.childForFieldName("body"), wholeIsSig: true, exported: isExportedJs(node) };
    case "type_alias_declaration":
      return { kind: "type", nameNode: node.childForFieldName("name"), body: null, wholeIsSig: true, exported: isExportedJs(node) };
    case "enum_declaration":
      return { kind: "enum", nameNode: node.childForFieldName("name"), body: node.childForFieldName("body"), wholeIsSig: true, exported: isExportedJs(node) };
    case "method_definition":
    case "method_signature":
    case "abstract_method_signature": {
      const nameNode = node.childForFieldName("name");
      const kind = nameNode?.text === "constructor" ? "constructor" : "method";
      return { kind, nameNode, body: node.childForFieldName("body") };
    }
    case "variable_declarator":
    case "public_field_definition": {
      const value = node.childForFieldName("value");
      if (!value || !["arrow_function", "function_expression", "function", "generator_function"].includes(value.type)) return null;
      const nameNode = node.childForFieldName("name") ?? node.childForFieldName("property");
      return {
        kind: inContainer ? "method" : "function",
        nameNode,
        body: value.childForFieldName("body"),
        exported: node.type === "variable_declarator" ? isExportedJs(node.parent ?? node) : undefined,
      };
    }
  }
  return null;
}

function pyDef(node: Node, inContainer: boolean): DefInfo | null {
  if (node.type === "function_definition") {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? "";
    return { kind: inContainer ? (name === "__init__" ? "constructor" : "method") : "function", nameNode, body: node.childForFieldName("body"), exported: !name.startsWith("_") || /^__\w+__$/.test(name) };
  }
  if (node.type === "class_definition") {
    const name = node.childForFieldName("name")?.text ?? "";
    return { kind: "class", nameNode: node.childForFieldName("name"), body: node.childForFieldName("body"), exported: !name.startsWith("_") };
  }
  return null;
}

function goDef(node: Node): DefInfo | null {
  const upper = (s?: string) => !!s && /^[A-Z]/.test(s);
  if (node.type === "function_declaration") {
    const nameNode = node.childForFieldName("name");
    return { kind: "function", nameNode, body: node.childForFieldName("body"), exported: upper(nameNode?.text) };
  }
  if (node.type === "method_declaration") {
    const nameNode = node.childForFieldName("name");
    const recv = node.childForFieldName("receiver");
    const recvType = recv?.descendantsOfType("type_identifier")[0]?.text;
    return { kind: "method", nameNode, body: node.childForFieldName("body"), qualPrefix: recvType, exported: upper(nameNode?.text) };
  }
  if (node.type === "type_spec") {
    const nameNode = node.childForFieldName("name");
    const t = node.childForFieldName("type")?.type;
    const kind: SymbolKind = t === "struct_type" ? "struct" : t === "interface_type" ? "interface" : "type";
    return { kind, nameNode, body: null, wholeIsSig: true, exported: upper(nameNode?.text) };
  }
  return null;
}

function javaDef(node: Node): DefInfo | null {
  const isPublic = (n: Node) => n.namedChildren.some((c) => c?.type === "modifiers" && /\bpublic\b/.test(c.text));
  switch (node.type) {
    case "class_declaration":
    case "record_declaration":
      return { kind: "class", nameNode: node.childForFieldName("name"), body: node.childForFieldName("body"), exported: isPublic(node) };
    case "interface_declaration":
      return { kind: "interface", nameNode: node.childForFieldName("name"), body: node.childForFieldName("body"), exported: isPublic(node) };
    case "enum_declaration":
      return { kind: "enum", nameNode: node.childForFieldName("name"), body: node.childForFieldName("body"), exported: isPublic(node) };
    case "method_declaration":
      return { kind: "method", nameNode: node.childForFieldName("name"), body: node.childForFieldName("body"), exported: isPublic(node) };
    case "constructor_declaration":
      return { kind: "constructor", nameNode: node.childForFieldName("name"), body: node.childForFieldName("body"), exported: isPublic(node) };
  }
  return null;
}

function defOf(lang: LangId, node: Node, inContainer: boolean): DefInfo | null {
  switch (lang) {
    case "typescript":
    case "tsx":
    case "javascript":
      return jsDef(node, inContainer);
    case "python":
      return pyDef(node, inContainer);
    case "go":
      return goDef(node);
    case "java":
      return javaDef(node);
  }
}

function collectImports(lang: LangId, root: Node, file: string): ImportSite[] {
  const out: ImportSite[] = [];
  const unquote = (s: string) => s.replace(/^['"`]|['"`]$/g, "");
  const walk = (n: Node) => {
    switch (lang) {
      case "typescript":
      case "tsx":
      case "javascript":
        if ((n.type === "import_statement" || n.type === "export_statement") && n.childForFieldName("source")) {
          const names = n.descendantsOfType(["identifier", "type_identifier"]).map((x) => x!.text);
          out.push({ file, source: unquote(n.childForFieldName("source")!.text), names });
          return;
        }
        break;
      case "python":
        if (n.type === "import_statement") {
          for (const d of n.childrenForFieldName("name")) if (d) out.push({ file, source: d.text.split(" as ")[0], names: [d.text.split(".").pop()!] });
          return;
        }
        if (n.type === "import_from_statement") {
          const mod = n.childForFieldName("module_name")?.text ?? "";
          const names = n.childrenForFieldName("name").map((d) => d!.text.split(" as ")[0]);
          out.push({ file, source: mod, names });
          return;
        }
        break;
      case "go":
        if (n.type === "import_spec") {
          const src = unquote(n.childForFieldName("path")?.text ?? "");
          out.push({ file, source: src, names: [n.childForFieldName("name")?.text ?? src.split("/").pop()!] });
          return;
        }
        break;
      case "java":
        if (n.type === "import_declaration") {
          const src = squash(n.text.replace(/^import\s+(static\s+)?/, "").replace(/;$/, ""));
          out.push({ file, source: src, names: [src.split(".").pop()!] });
          return;
        }
        break;
    }
    for (const c of n.namedChildren) if (c) walk(c);
  };
  walk(root);
  return out;
}

/** Parse and index one file. Returns undefined for unsupported languages. */
export async function indexFile(path: string, content: string): Promise<FileIndex | undefined> {
  const file = normPath(path);
  const lang = langForPath(file);
  if (!lang) return undefined;
  const { parser, refQuery } = await loadLanguage(lang);
  const tree = parser.parse(content);
  if (!tree) return undefined;
  try {
    const root = tree.rootNode;
    const symbols: SymbolDef[] = [];
    const ranges: { id: string; start: number; end: number }[] = [];

    const visit = (node: Node, containers: string[], inContainer: boolean) => {
      const def = defOf(lang, node, inContainer);
      let nextContainers = containers;
      let nextIn = inContainer;
      if (def) {
        const name = def.name ?? def.nameNode?.text;
        if (name) {
          const prefix = def.qualPrefix ? [def.qualPrefix] : containers;
          const qualname = [...prefix, name].join(".");
          const sig = def.wholeIsSig ? squash(node.text) : header(node, def.body);
          const bodyText = def.body ? squash(def.body.text) : squash(node.text);
          const id = `${file}#${qualname}`;
          // Overloads and redeclarations share an id; keep the first, but widen its range.
          if (!symbols.some((s) => s.id === id)) {
            symbols.push({
              id,
              file,
              name,
              qualname,
              kind: def.kind,
              start_line: node.startPosition.row + 1,
              end_line: node.endPosition.row + 1,
              sig,
              sig_hash: shortHash(sig),
              body_hash: shortHash(bodyText),
              exported: def.exported ?? containersExported(symbols, containers, file),
            });
          }
          ranges.push({ id, start: node.startIndex, end: node.endIndex });
          if (CONTAINER_KINDS.has(def.kind)) {
            nextContainers = [...prefix, name];
            nextIn = true;
          }
        }
      }
      for (const c of node.namedChildren) if (c) visit(c, nextContainers, nextIn);
    };
    visit(root, [], false);

    const enclosing = (idx: number) => {
      let best: { id: string; start: number; end: number } | undefined;
      for (const r of ranges) if (r.start <= idx && idx < r.end && (!best || r.end - r.start < best.end - best.start)) best = r;
      return best?.id;
    };

    const refs: RefSite[] = [];
    for (const m of refQuery.matches(root)) {
      const nameCap = m.captures.find((c) => c.name === "name") ?? m.captures.find((c) => c.name === "type");
      if (!nameCap) continue;
      const n = nameCap.node;
      // Skip identifiers that are the name of a definition (e.g. `class Foo` matches type_identifier).
      const parentName = n.parent?.childForFieldName("name");
      if (parentName && parentName.startIndex === n.startIndex && parentName.endIndex === n.endIndex && nameCap.name === "type") continue;
      const recv = m.captures.find((c) => c.name === "recv")?.node.text;
      refs.push({
        file,
        name: n.text,
        line: n.startPosition.row + 1,
        kind: nameCap.name === "type" ? "type" : "call",
        recv: recv ? squash(recv).slice(0, 80) : undefined,
        from_symbol: enclosing(n.startIndex),
      });
    }

    return {
      path: file,
      lang,
      content_hash: shortHash(content, 16),
      has_errors: root.hasError,
      symbols,
      refs,
      imports: collectImports(lang, root, file),
    };
  } finally {
    tree.delete();
  }
}

function containersExported(symbols: SymbolDef[], containers: string[], file: string): boolean {
  if (containers.length === 0) return false;
  const parent = symbols.find((s) => s.id === `${file}#${containers.join(".")}`);
  return parent?.exported ?? false;
}
