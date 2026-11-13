import pc from "picocolors";
import type { PolicyStatus, Report } from "../types.js";

const MAX_PER_RULE = 5;
const MAX_LOC = 56;
const MAX_EVIDENCE = 44;

/**
 * Pad or shorten to exactly `width` columns. Paths are cut at the start so the
 * file name and line number stay visible; evidence is cut at the end.
 */
export function fit(s: string, width: number, cut: "start" | "end"): string {
  if (s.length <= width) return s.padEnd(width);
  return cut === "start" ? "…" + s.slice(s.length - width + 1) : s.slice(0, width - 1) + "…";
}

export function formatPretty(report: Report, opts: { color?: boolean } = {}): string {
  const c = pc.createColors(opts.color ?? pc.isColorSupported);
  const out: string[] = [];
  const secs = (report.durationMs / 1000).toFixed(1);
  out.push(c.dim(`dontsue v${report.version} — scanned ${report.scannedFiles} files in ${secs}s`), "");

  if (report.findings.length) {
    out.push(c.bold("DATA COLLECTION DETECTED"));
    // Group by rule so 40 email inputs don't flood the screen.
    const byRule = new Map<string, typeof report.findings>();
    for (const f of report.findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);

    const rows: string[][] = [];
    for (const group of byRule.values()) {
      for (const f of group.slice(0, MAX_PER_RULE)) {
        rows.push([f.category, f.line ? `${f.file}:${f.line}` : f.file, f.evidence, f.confidence]);
      }
      if (group.length > MAX_PER_RULE) rows.push(["", c.dim(`… and ${group.length - MAX_PER_RULE} more (${group[0]!.ruleId})`), "", ""]);
    }
    const w0 = Math.max(...rows.map((r) => r[0]!.length));
    const w1 = Math.min(MAX_LOC, Math.max(...rows.map((r) => r[1]!.length)));
    const w2 = Math.min(MAX_EVIDENCE, Math.max(...rows.map((r) => r[2]!.length)));
    for (const [cat, loc, ev, conf] of rows) {
      if (!cat) {
        // "… and N more" row: let it span the table.
        out.push(`  ${"".padEnd(w0)}  ${loc}`);
        continue;
      }
      const confColor = conf === "high" ? c.red : conf === "medium" ? c.yellow : c.dim;
      out.push(`  ${c.cyan(cat.padEnd(w0))}  ${fit(loc!, w1, "start")}  ${fit(ev!, w2, "end")}  ${confColor(conf!)}`);
    }
  } else {
    out.push(c.green("No data collection detected."));
  }

  out.push("", c.bold("POLICIES"));
  const line = (label: string, p: PolicyStatus) => {
    const first = p.evidence[0];
    const where = first ? `${first.detail}${first.via !== "route" ? c.dim(` (${first.via})`) : ""}` : "not found";
    const more = p.evidence.length > 1 ? c.dim(` +${p.evidence.length - 1} more`) : "";
    out.push(`  ${p.found ? c.green("✔") : c.red("✖")} ${label.padEnd(18)}${where}${more}`);
  };
  line("Privacy policy", report.policies.privacyPolicy);
  line("Terms of service", report.policies.termsOfService);
  line("Cookie consent", report.policies.cookieConsent);

  if (report.issues.length) {
    out.push("", c.bold("ISSUES"));
    for (const i of report.issues) {
      const tag = i.severity === "error" ? c.red("✖ error") : c.yellow("⚠ warn ");
      out.push(`  ${tag}  ${c.bold(i.id)}`);
      out.push(`           ${i.message}`);
      out.push(`           ${c.dim("→ " + i.fix)}`, "");
    }
  } else {
    out.push("");
  }

  if (report.skipped.length) {
    out.push(c.dim(`Skipped ${report.skipped.length} file(s): ${report.skipped.map((s) => `${s.file} (${s.reason})`).join(", ")}`));
  }

  const { errors, warnings } = report.summary;
  const summary = `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`;
  out.push(errors ? c.red(c.bold(summary)) : warnings ? c.yellow(summary) : c.green(summary));
  out.push(c.dim("Not legal advice. dontsue flags likely gaps; it can't confirm compliance."));
  return out.join("\n");
}
