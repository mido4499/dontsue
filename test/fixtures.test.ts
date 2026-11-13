import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scan } from "../src/scan.js";
import type { Report } from "../src/types.js";
import { ROOT, fixture } from "./helpers.js";

interface Expectation {
  /** Exact issue list, as "id:severity". */
  issues: string[];
  /** ruleIds that must appear in findings (exact set when `exactFindings`). */
  findings?: string[];
  exactFindings?: boolean;
  privacy?: boolean;
  terms?: boolean;
  consent?: boolean;
  check?: (r: Report) => void;
}

const EXPECTED: Record<string, Expectation> = {
  "clean-static-site": { issues: [], findings: [], exactFindings: true, privacy: false },
  "signup-no-policy": {
    issues: ["missing-privacy-policy:error"],
    findings: ["pii/email-field", "pii/password-field"],
    exactFindings: true,
    privacy: false,
  },
  "signup-with-policy": {
    issues: [],
    findings: ["pii/email-field", "pii/password-field"],
    privacy: true,
    terms: true,
    check: (r) => {
      // Route group "(legal)" must still be recognized.
      expect(r.policies.termsOfService.evidence.map((e) => e.detail)).toContain("app/(legal)/terms/page.tsx");
    },
  },
  "ga-no-consent": {
    issues: ["tracking-without-consent:error"],
    findings: ["tracker/google-analytics"],
    exactFindings: true,
    privacy: true,
    consent: false,
  },
  "ga-with-consent": { issues: [], findings: ["tracker/google-analytics"], privacy: true, consent: true },
  "policy-via-footer-link": {
    issues: [],
    findings: ["pii/email-field"],
    privacy: true,
    check: (r) => {
      expect(r.policies.privacyPolicy.evidence[0]).toMatchObject({ via: "link", detail: "https://example.com/legal/privacy-policy" });
    },
  },
  "policy-in-config": {
    issues: [],
    findings: ["pii/phone-field"],
    privacy: true,
    check: (r) => expect(r.policies.privacyPolicy.evidence[0]?.via).toBe("config"),
  },
  "nextjs-pages-router": {
    issues: ["missing-terms-of-service:warn"],
    findings: ["pii/email-field", "payment/payment-provider"],
    exactFindings: true,
    privacy: true,
    terms: false,
    check: (r) => {
      const stripe = r.findings.find((f) => f.ruleId === "payment/payment-provider");
      expect(stripe).toMatchObject({ file: "package.json", line: 5, evidence: "@stripe/stripe-js@4.0.0" });
    },
  },
  "vite-react": {
    issues: ["missing-privacy-policy:error", "tracking-without-consent:error"],
    findings: ["tracker/posthog", "location/geolocation"],
    exactFindings: true,
    check: (r) => {
      // Declared in devDependencies; the import must not produce a duplicate finding.
      expect(r.findings.filter((f) => f.ruleId === "tracker/posthog")).toHaveLength(1);
      expect(r.findings.find((f) => f.ruleId === "location/geolocation")).toMatchObject({ file: "src/App.tsx", line: 6 });
    },
  },
  "vue-sfc": { issues: [], findings: ["pii/email-field"], exactFindings: true, privacy: true },
  "ignore-comments": { issues: [], findings: [], exactFindings: true },
  "privacy-not-linked": { issues: ["privacy-policy-not-linked:warn"], findings: ["pii/email-field"], privacy: true },
  "monorepo-imports": {
    issues: ["missing-privacy-policy:error", "tracking-without-consent:error"],
    findings: ["tracker/mixpanel"],
    exactFindings: true,
    check: (r) => expect(r.findings[0]).toMatchObject({ file: "src/analytics.ts", line: 1, evidence: `import "mixpanel-browser"` }),
  },
  "false-positives": { issues: [], findings: [], exactFindings: true, privacy: false },
  "ai-and-email-services": {
    // Email is high confidence, so this is an error even though AI alone would only warn.
    issues: ["missing-privacy-policy:error"],
    findings: ["ai/anthropic", "email/resend"],
    exactFindings: true,
    check: (r) => {
      expect(r.findings.find((f) => f.ruleId === "ai/anthropic")).toMatchObject({ file: "package.json", line: 4, confidence: "medium" });
      // Matched by API URL, since there's no SDK.
      expect(r.findings.find((f) => f.ruleId === "email/resend")).toMatchObject({
        file: "lib/email.ts",
        line: 5,
        evidence: "https://api.resend.com/emails",
      });
      expect(r.issues[0]!.message).toContain("shares it with Anthropic and Resend,");
    },
  },
  "broken-file": {
    issues: ["missing-privacy-policy:error"],
    findings: ["pii/email-field"],
    exactFindings: true,
    check: (r) => {
      expect(r.skipped.map((s) => s.file).sort()).toEqual(["package.json", "src/broken.ts"]);
    },
  },
};

describe("fixtures", () => {
  it("every fixture directory has an expectation (and vice versa)", () => {
    const dirs = readdirSync(path.join(ROOT, "test/fixtures")).sort();
    expect(dirs).toEqual(Object.keys(EXPECTED).sort());
  });

  describe.each(Object.entries(EXPECTED))("%s", (name, exp) => {
    it("produces the expected report", async () => {
      const r = await scan(fixture(name));
      expect(r.issues.map((i) => `${i.id}:${i.severity}`)).toEqual(exp.issues);

      const ruleIds = [...new Set(r.findings.map((f) => f.ruleId))].sort();
      if (exp.findings) {
        if (exp.exactFindings) expect(ruleIds).toEqual([...exp.findings].sort());
        else for (const id of exp.findings) expect(ruleIds).toContain(id);
      }
      if (exp.privacy !== undefined) expect(r.policies.privacyPolicy.found).toBe(exp.privacy);
      if (exp.terms !== undefined) expect(r.policies.termsOfService.found).toBe(exp.terms);
      if (exp.consent !== undefined) expect(r.policies.cookieConsent.found).toBe(exp.consent);

      expect(r.summary.errors).toBe(exp.issues.filter((i) => i.endsWith(":error")).length);
      expect(r.summary.warnings).toBe(exp.issues.filter((i) => i.endsWith(":warn")).length);
      // Paths in reports are always relative and use forward slashes.
      for (const f of r.findings) expect(f.file).not.toMatch(/^\/|\\/);
      exp.check?.(r);
    });
  });

  it("respects rules: off in config", async () => {
    const r = await scan(fixture("signup-no-policy"), { config: { rules: { "pii/password-field": "off" } } });
    expect(r.findings.map((f) => f.ruleId)).toEqual(["pii/email-field"]);
  });

  it("respects extra ignore globs in config", async () => {
    const r = await scan(fixture("signup-no-policy"), { config: { ignore: ["app/signup/**"] } });
    expect(r.findings).toEqual([]);
  });

  it("treats cookieConsent: true in config as consent", async () => {
    const r = await scan(fixture("ga-no-consent"), { config: { cookieConsent: true } });
    expect(r.issues).toEqual([]);
  });

  it("rejects a missing path and a file path", async () => {
    await expect(scan(fixture("does-not-exist"))).rejects.toThrow(/Path not found/);
    await expect(scan(fixture("clean-static-site/index.html"))).rejects.toThrow(/Not a directory/);
  });
});
