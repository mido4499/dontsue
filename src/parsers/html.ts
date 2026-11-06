import { Parser } from "htmlparser2";
import type { ElementFact, FileFacts } from "../types.js";
import { emptyFacts, extractJsFacts } from "./js.js";

/**
 * Parse HTML-like files (.html, .vue, .svelte, .astro) into facts.
 * Inline <script> bodies are fed through the JS parser with correct line numbers.
 */
export function extractHtmlFacts(code: string, file: string): FileFacts {
  const facts = emptyFacts(file);
  const lineStarts = computeLineStarts(code);
  const lineAt = (offset: number) => lineOf(lineStarts, offset);

  // Elements whose text we're still collecting (for link text).
  const open: { el: ElementFact; name: string }[] = [];
  let script: { start: number; body: string; lang?: string } | null = null;
  const scriptErrors: string[] = [];

  // Astro frontmatter is plain TS between --- fences at the top of the file.
  if (file.endsWith(".astro")) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(code);
    if (m?.[1]) tryJs(m[1], file.replace(/\.astro$/, ".ts"), 2); // body starts after the opening ---
  }

  function tryJs(body: string, virtualFile: string, startLine: number) {
    try {
      extractJsFacts(body, virtualFile, startLine - 1, facts);
    } catch (e) {
      scriptErrors.push((e as Error).message);
    }
  }

  const parser: Parser = new Parser(
    {
      onopentag(name, attribs) {
        const line = lineAt(parser.startIndex);
        if (name === "script") {
          script = { start: parser.endIndex + 1, body: "", lang: attribs.lang };
        }
        const el: ElementFact = { name, attrs: { ...attribs }, text: "", line };
        facts.elements.push(el);
        if (name !== "script" && name !== "style") open.push({ el, name });
        for (const v of Object.values(attribs)) if (v) facts.strings.push({ value: v, line });
      },
      ontext(text) {
        if (script) {
          script.body += text;
          return;
        }
        for (const o of open) o.el.text += text;
      },
      onclosetag(name) {
        if (name === "script" && script) {
          const s: { start: number; body: string; lang?: string } = script;
          script = null;
          if (s.body.trim()) {
            const ext = s.lang === "ts" || s.lang === "typescript" ? ".ts" : ".js";
            tryJs(s.body, file + ext, lineAt(s.start));
          }
          return;
        }
        const idx = open.map((o) => o.name).lastIndexOf(name);
        if (idx !== -1) {
          for (const o of open.splice(idx)) o.el.text = o.el.text.replace(/\s+/g, " ").trim();
        }
      },
    },
    { lowerCaseTags: !/\.(vue|svelte|astro)$/.test(file), lowerCaseAttributeNames: false, recognizeSelfClosing: true },
  );
  parser.write(code);
  parser.end();
  for (const o of open) o.el.text = o.el.text.replace(/\s+/g, " ").trim();
  return facts;
}

function computeLineStarts(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
