import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractHtmlFacts } from "../src/parsers/html.js";
import { extractJsFacts } from "../src/parsers/js.js";
import { collectorRules } from "../src/rules/collectors.js";
import type { ElementMatch } from "../src/rules/collectors.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const fixture = (name: string) => path.join(ROOT, "test/fixtures", name);

export function rule(id: string) {
  const r = collectorRules.find((r) => r.id === id);
  if (!r) throw new Error(`No rule ${id}`);
  return r;
}

/** Run a rule's element matcher over a JSX (default) or HTML snippet. */
export function matchElements(ruleId: string, code: string, file = "x.tsx"): ElementMatch[] {
  const r = rule(ruleId);
  const facts = file.endsWith(".html") || file.endsWith(".vue") ? extractHtmlFacts(code, file) : extractJsFacts(code, file);
  return facts.elements.map((el) => r.element!(el)).filter((m): m is ElementMatch => m !== null);
}
