import { parse, type ParserPlugin } from "@babel/parser";
import type { ElementFact, FileFacts } from "../types.js";

type Node = { type: string; loc?: { start: { line: number } } | null; [key: string]: unknown };

export function emptyFacts(file: string): FileFacts {
  return { file, elements: [], members: [], calls: [], strings: [], imports: [] };
}

function pluginsFor(file: string): ParserPlugin[] {
  if (/\.(ts|mts|cts)$/.test(file)) return ["typescript"];
  if (/\.tsx$/.test(file)) return ["typescript", "jsx"];
  return ["jsx"];
}

/**
 * Parse JS/TS/JSX source into facts. `lineOffset` is added to every line,
 * for scripts embedded in HTML.
 *
 * Throws if the source is unparseable; callers record that as a skipped file.
 */
export function extractJsFacts(
  code: string,
  file: string,
  lineOffset = 0,
  into: FileFacts = emptyFacts(file),
): FileFacts {
  const ast = parse(code, {
    sourceType: "unambiguous",
    plugins: [...pluginsFor(file), "decorators"],
    errorRecovery: true,
  });

  const lineOf = (n: Node) => (n.loc?.start.line ?? 1) + lineOffset;

  const visit = (node: Node): void => {
    switch (node.type) {
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration": {
        const src = node.source as Node | null | undefined;
        if (src?.type === "StringLiteral") into.imports.push({ value: src.value as string, line: lineOf(node) });
        break;
      }
      case "ImportExpression": {
        const src = node.source as Node;
        if (src.type === "StringLiteral") into.imports.push({ value: src.value as string, line: lineOf(node) });
        break;
      }
      case "CallExpression":
      case "OptionalCallExpression": {
        const callee = node.callee as Node;
        if (callee.type === "Identifier") {
          const name = callee.name as string;
          into.calls.push({ value: name, line: lineOf(node) });
          const arg = (node.arguments as Node[])[0];
          if (name === "require" && arg?.type === "StringLiteral") {
            into.imports.push({ value: arg.value as string, line: lineOf(node) });
          }
        }
        break;
      }
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const path = memberPath(node);
        if (path) into.members.push({ value: path, line: lineOf(node) });
        break;
      }
      case "StringLiteral":
        into.strings.push({ value: node.value as string, line: lineOf(node) });
        break;
      case "TemplateLiteral":
        for (const q of node.quasis as Node[]) {
          const cooked = (q.value as { cooked?: string }).cooked;
          if (cooked) into.strings.push({ value: cooked, line: lineOf(q) });
        }
        break;
      case "JSXElement":
        into.elements.push(jsxElement(node, lineOf(node)));
        break;
    }

    for (const key in node) {
      if (key === "loc" || key === "start" || key === "end" || key === "extra" || key.endsWith("Comments")) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) if (isNode(c)) visit(c);
      } else if (isNode(child)) {
        visit(child);
      }
    }
  };

  visit(ast.program as unknown as Node);
  return into;
}

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && typeof (v as Node).type === "string";
}

/** "window.navigator.geolocation" -> "navigator.geolocation". Returns null for computed access. */
function memberPath(node: Node): string | null {
  const parts: string[] = [];
  let cur: Node = node;
  while (cur.type === "MemberExpression" || cur.type === "OptionalMemberExpression") {
    const prop = cur.property as Node;
    if (cur.computed) {
      if (prop.type !== "StringLiteral") return null;
      parts.unshift(prop.value as string);
    } else if (prop.type === "Identifier") {
      parts.unshift(prop.name as string);
    } else {
      return null;
    }
    cur = cur.object as Node;
  }
  if (cur.type !== "Identifier") return null;
  const root = cur.name as string;
  if (root !== "window" && root !== "globalThis" && root !== "self") parts.unshift(root);
  return parts.join(".");
}

function jsxName(n: Node): string {
  switch (n.type) {
    case "JSXIdentifier":
      return n.name as string;
    case "JSXMemberExpression":
      return `${jsxName(n.object as Node)}.${jsxName(n.property as Node)}`;
    case "JSXNamespacedName":
      return `${jsxName(n.namespace as Node)}:${jsxName(n.name as Node)}`;
    default:
      return "";
  }
}

function jsxElement(node: Node, line: number): ElementFact {
  const opening = node.openingElement as Node;
  const attrs: Record<string, string | true> = {};
  for (const attr of opening.attributes as Node[]) {
    if (attr.type !== "JSXAttribute") continue;
    const name = jsxName(attr.name as Node);
    attrs[name] = staticAttrValue(attr.value as Node | null);
  }
  return { name: jsxName(opening.name as Node), attrs, text: jsxText(node).replace(/\s+/g, " ").trim(), line };
}

function staticAttrValue(v: Node | null): string | true {
  if (!v) return "true"; // <input required />
  if (v.type === "StringLiteral") return v.value as string;
  if (v.type === "JSXExpressionContainer") {
    const e = v.expression as Node;
    if (e.type === "StringLiteral") return e.value as string;
    if (e.type === "TemplateLiteral" && (e.expressions as Node[]).length === 0) {
      return ((e.quasis as Node[])[0]?.value as { cooked?: string }).cooked ?? true;
    }
  }
  return true;
}

function jsxText(node: Node): string {
  let out = "";
  for (const child of (node.children as Node[] | undefined) ?? []) {
    if (child.type === "JSXText") out += child.value as string;
    else if (child.type === "JSXElement" || child.type === "JSXFragment") out += " " + jsxText(child);
    else if (child.type === "JSXExpressionContainer") {
      const e = child.expression as Node;
      if (e.type === "StringLiteral") out += e.value as string;
    }
  }
  return out;
}
