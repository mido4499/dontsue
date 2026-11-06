import { describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluate.js";
import type { Finding, Policies, PolicyStatus } from "../src/types.js";

const none: PolicyStatus = { found: false, evidence: [] };
const route: PolicyStatus = { found: true, evidence: [{ via: "route", detail: "app/privacy/page.tsx" }] };
const linked: PolicyStatus = { found: true, evidence: [{ via: "link", detail: "/privacy" }] };
const policies = (p: Partial<Policies> = {}): Policies => ({ privacyPolicy: none, termsOfService: none, cookieConsent: none, ...p });

const f = (over: Partial<Finding>): Finding => ({
  ruleId: "pii/email-field",
  category: "pii",
  dataTypes: ["email"],
  file: "a.tsx",
  evidence: "",
  confidence: "high",
  requires: ["privacy-policy"],
  ...over,
});
const ids = (xs: { id: string; severity: string }[]) => xs.map((x) => `${x.id}:${x.severity}`);

describe("evaluate", () => {
  it("returns nothing when nothing is collected", () => {
    expect(evaluate([], policies())).toEqual([]);
  });

  it("errors on high-confidence PII without a privacy policy", () => {
    expect(ids(evaluate([f({})], policies()))).toEqual(["missing-privacy-policy:error"]);
  });

  it("only warns when all evidence is medium confidence", () => {
    expect(ids(evaluate([f({ confidence: "medium" })], policies()))).toEqual(["missing-privacy-policy:warn"]);
  });

  it("ignores low-confidence findings entirely", () => {
    expect(evaluate([f({ confidence: "low" })], policies())).toEqual([]);
  });

  it("is satisfied by a linked privacy policy", () => {
    expect(evaluate([f({})], policies({ privacyPolicy: linked }))).toEqual([]);
  });

  it("warns when a privacy page exists but is never linked", () => {
    expect(ids(evaluate([f({})], policies({ privacyPolicy: route })))).toEqual(["privacy-policy-not-linked:warn"]);
  });

  it("errors on trackers without consent, naming the vendors", () => {
    const tracker = f({ ruleId: "tracker/posthog", category: "tracking", vendor: "PostHog", requires: ["privacy-policy", "cookie-consent"] });
    const issues = evaluate([tracker], policies({ privacyPolicy: linked }));
    expect(ids(issues)).toEqual(["tracking-without-consent:error"]);
    expect(issues[0]!.message).toContain("PostHog");
  });

  it("warns (never errors) on accounts without terms", () => {
    const auth = f({ ruleId: "auth/auth-library", category: "auth", requires: ["privacy-policy", "terms-of-service"] });
    expect(ids(evaluate([auth], policies({ privacyPolicy: linked })))).toEqual(["missing-terms-of-service:warn"]);
  });

  it("links issues back to the findings that caused them", () => {
    const issues = evaluate([f({}), f({ ruleId: "pii/phone-field" }), f({})], policies());
    expect(issues[0]!.relatedFindings).toEqual(["pii/email-field", "pii/phone-field"]);
  });
});
