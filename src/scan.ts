import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";
import { evaluate } from "./evaluate.js";
import { DOC_EXT, MARKUP_EXT, MAX_FILE_BYTES, SOURCE_EXT, listFiles } from "./files.js";
import { extractHtmlFacts } from "./parsers/html.js";
import { extractJsFacts } from "./parsers/js.js";
import { collectorRules, type CollectorRule } from "./rules/collectors.js";
import {
  CONSENT_DEPENDENCIES,
  CONSENT_SCRIPTS,
  classifyLink,
  classifyRoute,
  importPackageName,
  matchesPackage,
} from "./rules/policies.js";
import type { Config, DependencyFact, FileFacts, Finding, Policies, Report, SkippedFile } from "./types.js";

export class ScanError extends Error {}

export interface ScanOptions {
  /** Use this config instead of reading dontsue.config.json. */
  config?: Config;
  /** Path to a config file. Ignored if `config` is given. */
  configPath?: string;
}

export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return pkg.version as string;
  } catch {
    return "0.0.0";
  }
})();

const IGNORE_LINE = /dontsue-ignore(?!-file)/;
const IGNORE_FILE = /dontsue-ignore-file/;

export interface ParsedFile {
  facts: FileFacts;
  /** Lines whose findings are suppressed by a `dontsue-ignore` comment. */
  ignoredLines: Set<number>;
}

export interface EvaluateParsedInput {
  root: string;
  scannedFiles: number;
  startedAt: number;
  parsed: ParsedFile[];
  dependencies: DependencyFact[];
  skipped: SkippedFile[];
  routes: { file: string; kinds: ("privacy" | "terms")[] }[];
  config: Config;
}

/** Run collector rules, policy detection, and issue evaluation on already-parsed facts. */
export function buildReport(input: EvaluateParsedInput): Report {
  const { root, scannedFiles, startedAt, parsed, dependencies, skipped, routes, config } = input;
  const rules = collectorRules.filter((r) => config.rules?.[r.id] !== "off");
  const findings = rules.flatMap((rule) => runRule(rule, parsed, dependencies));
  findings.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.ruleId.localeCompare(b.ruleId));

  const policies = detectPolicies(parsed, dependencies, routes, config);
  const issues = evaluate(findings, policies);

  return {
    version: VERSION,
    root,
    scannedFiles,
    durationMs: Math.round(performance.now() - startedAt),
    findings,
    policies,
    issues,
    skipped,
    summary: {
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warn").length,
    },
  };
}

export async function scan(target: string, options: ScanOptions = {}): Promise<Report> {
  const started = performance.now();
  const root = path.resolve(target);

  const info = await stat(root).catch(() => null);
  if (!info) throw new ScanError(`Path not found: ${target}`);
  if (!info.isDirectory()) throw new ScanError(`Not a directory: ${target}`);

  const config = options.config ?? (await loadConfig(root, options.configPath));
  const files = await listFiles(root, config.ignore);

  const parsed: ParsedFile[] = [];
  const dependencies: DependencyFact[] = [];
  const skipped: SkippedFile[] = [];
  const routes: { file: string; kinds: ("privacy" | "terms")[] }[] = [];

  for (const rel of files) {
    const abs = path.join(root, rel);
    const size = (await stat(abs)).size;
    if (size > MAX_FILE_BYTES) {
      skipped.push({ file: rel, reason: `larger than ${MAX_FILE_BYTES / 1_000_000}MB` });
      continue;
    }

    const kinds = classifyRoute(rel);
    if (kinds.length) routes.push({ file: rel, kinds });

    const code = await readFile(abs, "utf8");

    if (path.basename(rel) === "package.json") {
      try {
        dependencies.push(...readDependencies(code, rel));
      } catch (e) {
        skipped.push({ file: rel, reason: `invalid JSON: ${(e as Error).message}` });
      }
      continue;
    }
    if (DOC_EXT.test(rel)) continue; // markdown only matters as a route
    if (IGNORE_FILE.test(code)) continue;

    try {
      const facts = MARKUP_EXT.test(rel)
        ? extractHtmlFacts(code, rel)
        : SOURCE_EXT.test(rel)
          ? extractJsFacts(code, rel)
          : null;
      if (facts) parsed.push({ facts, ignoredLines: ignoredLines(code) });
    } catch (e) {
      skipped.push({ file: rel, reason: `parse error: ${(e as Error).message.split("\n")[0]}` });
    }
  }

  return buildReport({
    root,
    scannedFiles: files.length,
    startedAt: started,
    parsed,
    dependencies,
    skipped,
    routes,
    config,
  });
}

function readDependencies(code: string, file: string): DependencyFact[] {
  const pkg = JSON.parse(code) as Record<string, unknown>;
  const out: DependencyFact[] = [];
  const lines = code.split("\n");
  // devDependencies are included because SPA bundlers (Vite etc.) ship them to the browser.
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const deps = pkg[field];
    if (typeof deps !== "object" || deps === null) continue;
    for (const [name, version] of Object.entries(deps as Record<string, unknown>)) {
      const idx = lines.findIndex((l) => l.includes(`"${name}"`));
      out.push({ name, version: String(version), file, line: idx === -1 ? undefined : idx + 1 });
    }
  }
  return out;
}

function ignoredLines(code: string): Set<number> {
  const set = new Set<number>();
  if (!code.includes("dontsue-ignore")) return set;
  code.split("\n").forEach((line, i) => {
    if (IGNORE_LINE.test(line)) {
      set.add(i + 1); // same line
      set.add(i + 2); // next line
    }
  });
  return set;
}

function finding(rule: CollectorRule, file: string, line: number | undefined, evidence: string, confidence = rule.confidence): Finding {
  const f: Finding = {
    ruleId: rule.id,
    category: rule.category,
    dataTypes: rule.dataTypes,
    file,
    line,
    evidence,
    confidence,
    requires: rule.requires,
  };
  if (rule.vendor) f.vendor = rule.vendor;
  return f;
}

function runRule(rule: CollectorRule, files: ParsedFile[], deps: DependencyFact[]): Finding[] {
  const out: Finding[] = [];

  if (rule.dependencies) {
    for (const d of deps) {
      if (matchesPackage(d.name, rule.dependencies)) out.push(finding(rule, d.file, d.line, `${d.name}@${d.version}`));
    }
  }
  const matchedByDependency = out.length > 0;
  let matchedByImport = false;

  for (const { facts, ignoredLines } of files) {
    const ok = (line: number) => !ignoredLines.has(line);
    const once = (line: number, evidence: string) => {
      out.push(finding(rule, facts.file, line, evidence));
    };

    // Imports catch packages declared in a package.json outside the scan root (monorepos).
    if (rule.dependencies && !matchedByDependency && !matchedByImport) {
      const hit = facts.imports.find((i) => {
        const pkg = importPackageName(i.value);
        return pkg && ok(i.line) && matchesPackage(pkg, rule.dependencies!);
      });
      if (hit) {
        once(hit.line, `import "${hit.value}"`);
        matchedByImport = true;
      }
    }

    // Strings, calls and members: one finding per file is enough.
    let fileHit = false;
    if (rule.strings) {
      const hit = facts.strings.find((s) => ok(s.line) && rule.strings!.some((re) => re.test(s.value)));
      if (hit) {
        once(hit.line, truncate(hit.value));
        fileHit = true;
      }
    }
    if (!fileHit && rule.calls) {
      const hit = facts.calls.find((c) => ok(c.line) && rule.calls!.includes(c.value));
      if (hit) {
        once(hit.line, `${hit.value}(...)`);
        fileHit = true;
      }
    }
    if (!fileHit && rule.members) {
      const hit = facts.members.find(
        (m) => ok(m.line) && rule.members!.some((p) => m.value === p || m.value.startsWith(p + ".")),
      );
      if (hit) once(hit.line, hit.value);
    }

    // Elements: every matching field is its own finding.
    if (rule.element) {
      for (const el of facts.elements) {
        if (!ok(el.line)) continue;
        const m = rule.element(el);
        if (m) out.push(finding(rule, facts.file, el.line, m.evidence, m.confidence));
      }
    }
  }
  return out;
}

function detectPolicies(
  files: ParsedFile[],
  deps: DependencyFact[],
  routes: { file: string; kinds: ("privacy" | "terms")[] }[],
  config: Config,
): Policies {
  const policies: Policies = {
    privacyPolicy: { found: false, evidence: [] },
    termsOfService: { found: false, evidence: [] },
    cookieConsent: { found: false, evidence: [] },
  };
  const target = (k: "privacy" | "terms") => (k === "privacy" ? policies.privacyPolicy : policies.termsOfService);

  if (config.privacyPolicyUrl) policies.privacyPolicy.evidence.push({ via: "config", detail: config.privacyPolicyUrl });
  if (config.termsUrl) policies.termsOfService.evidence.push({ via: "config", detail: config.termsUrl });
  if (config.cookieConsent) policies.cookieConsent.evidence.push({ via: "config", detail: "cookieConsent: true" });

  for (const r of routes) {
    for (const k of r.kinds) target(k).evidence.push({ via: "route", detail: r.file, file: r.file });
  }

  for (const { facts } of files) {
    for (const el of facts.elements) {
      const { kinds, target: href } = classifyLink(el);
      for (const k of kinds) target(k).evidence.push({ via: "link", detail: href, file: facts.file, line: el.line });
    }
    for (const s of facts.strings) {
      const cmp = CONSENT_SCRIPTS.find((c) => c.pattern.test(s.value));
      if (cmp) policies.cookieConsent.evidence.push({ via: "script", detail: cmp.vendor, file: facts.file, line: s.line });
    }
    for (const i of facts.imports) {
      const pkg = importPackageName(i.value);
      if (pkg && matchesPackage(pkg, CONSENT_DEPENDENCIES)) {
        policies.cookieConsent.evidence.push({ via: "dependency", detail: pkg, file: facts.file, line: i.line });
      }
    }
  }

  for (const d of deps) {
    if (matchesPackage(d.name, CONSENT_DEPENDENCIES)) {
      policies.cookieConsent.evidence.push({ via: "dependency", detail: d.name, file: d.file, line: d.line });
    }
  }

  for (const p of Object.values(policies)) {
    p.evidence = dedupeEvidence(p.evidence);
    p.found = p.evidence.length > 0;
  }
  return policies;
}

function dedupeEvidence<T extends { via: string; detail: string; file?: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const key = `${x.via}|${x.detail}|${x.file ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function truncate(s: string, n = 80): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}
