import { describe, expect, it } from "vitest";
import { fit, formatPretty } from "../src/reporters/pretty.js";
import type { Finding, Report } from "../src/types.js";

describe("fit", () => {
  it("pads short strings to the width", () => {
    expect(fit("abc", 6, "end")).toBe("abc   ");
  });
  it("cuts paths at the start so the file and line stay visible", () => {
    const out = fit("very/long/nested/folder/Component.tsx:42", 20, "start");
    expect(out).toHaveLength(20);
    expect(out).toBe("…er/Component.tsx:42");
  });
  it("cuts evidence at the end", () => {
    expect(fit("<input autocomplete=\"shipping street-address\">", 12, "end")).toBe("<input auto…");
  });
});

describe("formatPretty", () => {
  const finding = (file: string, line: number): Finding => ({
    ruleId: "pii/email-field",
    category: "pii",
    dataTypes: ["email"],
    file,
    line,
    evidence: `<input type="email">`,
    confidence: "high",
    requires: ["privacy-policy"],
  });
  const none = { found: false, evidence: [] };
  const report = (findings: Finding[]): Report => ({
    version: "0.0.0",
    root: "/x",
    scannedFiles: 1,
    durationMs: 1,
    findings,
    policies: { privacyPolicy: none, termsOfService: none, cookieConsent: none },
    issues: [],
    skipped: [],
    summary: { errors: 0, warnings: 0 },
  });

  it("keeps finding rows aligned even with very long paths", () => {
    const out = formatPretty(
      report([
        finding("a.tsx", 1),
        finding("app/components/account/settings/really/deeply/nested/DeleteAccountSection.tsx", 96),
      ]),
      { color: false },
    );
    const rows = out.split("\n").filter((l) => l.includes(`<input type="email">`));
    expect(rows).toHaveLength(2);
    // The confidence column starts at the same position on every row.
    expect(new Set(rows.map((r) => r.indexOf("high"))).size).toBe(1);
    expect(rows[1]).toContain("DeleteAccountSection.tsx:96");
  });

  it("shows a summary row when a rule has more findings than fit", () => {
    const out = formatPretty(report(Array.from({ length: 8 }, (_, i) => finding("a.tsx", i + 1))), { color: false });
    expect(out).toContain("… and 3 more (pii/email-field)");
  });
});
