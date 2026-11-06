import { describe, expect, it } from "vitest";
import { collectorRules } from "../src/rules/collectors.js";
import { classifyLink, classifyRoute, importPackageName, matchesPackage } from "../src/rules/policies.js";
import type { ElementFact } from "../src/types.js";
import { matchElements } from "./helpers.js";

describe("rule registry", () => {
  it("has unique rule ids", () => {
    const ids = collectorRules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every rule has at least one matcher and one requirement", () => {
    for (const r of collectorRules) {
      expect(r.dependencies || r.strings || r.calls || r.members || r.element, r.id).toBeTruthy();
      expect(r.requires.length, r.id).toBeGreaterThan(0);
    }
  });

  it("only tracking rules require cookie consent", () => {
    for (const r of collectorRules.filter((r) => r.requires.includes("cookie-consent"))) {
      expect(r.category, r.id).toBe("tracking");
    }
  });
});

describe("pii/email-field", () => {
  it("detects type=email with high confidence", () => {
    expect(matchElements("pii/email-field", `<input type="email" />`)).toEqual([{ evidence: `<input type="email">`, confidence: "high" }]);
  });
  it("detects autocomplete=email in JSX (autoComplete) and HTML", () => {
    expect(matchElements("pii/email-field", `<input autoComplete="email" />`)).toHaveLength(1);
    expect(matchElements("pii/email-field", `<input autocomplete="email">`, "x.html")).toHaveLength(1);
  });
  it("detects name=user_email with medium confidence", () => {
    expect(matchElements("pii/email-field", `<input name="user_email" />`)[0]?.confidence).toBe("medium");
  });
  it("detects design-system components like <TextField type=email>", () => {
    expect(matchElements("pii/email-field", `<TextField type="email" />`)).toHaveLength(1);
    expect(matchElements("pii/email-field", `<Form.Input type="email" />`)).toHaveLength(1);
  });
  it("ignores plain text, hidden inputs, and non-field elements", () => {
    expect(matchElements("pii/email-field", `<p>Email us</p>`)).toHaveLength(0);
    expect(matchElements("pii/email-field", `<input type="hidden" name="email" />`)).toHaveLength(0);
    expect(matchElements("pii/email-field", `<div name="email" />`)).toHaveLength(0);
    expect(matchElements("pii/email-field", `<EmailIcon type="email" />`)).toHaveLength(0);
  });
  it("ignores dynamic type values", () => {
    expect(matchElements("pii/email-field", `<input type={kind} />`)).toHaveLength(0);
  });
});

describe("other form rules", () => {
  it.each([
    ["pii/phone-field", `<input type="tel" />`],
    ["pii/phone-field", `<input name="mobileNumber" />`],
    ["pii/name-field", `<input autoComplete="given-name" />`],
    ["pii/name-field", `<input name="first_name" />`],
    ["pii/address-field", `<input autoComplete="shipping street-address" />`],
    ["pii/address-field", `<input name="postal_code" />`],
    ["pii/birthdate-field", `<input autoComplete="bday" />`],
    ["pii/birthdate-field", `<input name="dateOfBirth" />`],
    ["pii/government-id-field", `<input name="ssn" />`],
    ["pii/password-field", `<input type="password" />`],
    ["payment/card-field", `<input autoComplete="cc-number" />`],
  ])("%s matches %s", (id, code) => {
    expect(matchElements(id, code)).toHaveLength(1);
  });

  it.each([
    ["pii/name-field", `<input name="name" />`], // too ambiguous (product name, file name...)
    ["pii/name-field", `<input name="username" />`],
    ["pii/address-field", `<input name="email_address" />`],
    ["pii/address-field", `<input name="ipAddress" />`],
    ["pii/phone-field", `<input type="text" name="q" />`],
    ["pii/password-field", `<input type="text" />`],
  ])("%s does not match %s", (id, code) => {
    expect(matchElements(id, code)).toHaveLength(0);
  });
});

describe("classifyRoute", () => {
  it.each([
    ["app/privacy/page.tsx", ["privacy"]],
    ["app/(legal)/privacy/page.tsx", ["privacy"]],
    ["src/app/privacy-policy/page.jsx", ["privacy"]],
    ["pages/privacy.tsx", ["privacy"]],
    ["pages/privacy/index.tsx", ["privacy"]],
    ["src/routes/privacy/+page.svelte", ["privacy"]],
    ["src/pages/terms-of-service.astro", ["terms"]],
    ["public/tos.html", ["terms"]],
    ["privacy.html", ["privacy"]],
    ["content/legal.md", ["privacy", "terms"]],
    ["app/terms/page.tsx", ["terms"]],
  ])("%s -> %j", (p, kinds) => {
    expect(classifyRoute(p)).toEqual(kinds);
  });

  it.each(["src/lib/privacy.ts", "src/utils/terms.js", "components/PrivacyBanner.tsx", "app/about/page.tsx", "privacy-utils.ts"])(
    "%s is not a policy page",
    (p) => {
      expect(classifyRoute(p)).toEqual([]);
    },
  );
});

describe("classifyLink", () => {
  const el = (name: string, attrs: ElementFact["attrs"], text = ""): ElementFact => ({ name, attrs, text, line: 1 });

  it("recognizes privacy links by href", () => {
    expect(classifyLink(el("a", { href: "/privacy" })).kinds).toEqual(["privacy"]);
    expect(classifyLink(el("Link", { href: "https://www.iubenda.com/privacy-policy/123" })).kinds).toEqual(["privacy"]);
  });
  it("recognizes links by text when the href is dynamic", () => {
    expect(classifyLink(el("Link", { href: true }, "Privacy Policy")).kinds).toEqual(["privacy"]);
    expect(classifyLink(el("a", { href: true }, "Terms of Use")).kinds).toEqual(["terms"]);
  });
  it("recognizes Vue router links via `to`", () => {
    expect(classifyLink(el("RouterLink", { to: "/terms" })).kinds).toEqual(["terms"]);
  });
  it("treats /legal as both", () => {
    expect(classifyLink(el("a", { href: "/legal" })).kinds.sort()).toEqual(["privacy", "terms"]);
  });
  it("ignores non-link elements that mention privacy", () => {
    expect(classifyLink(el("h1", {}, "Privacy Policy")).kinds).toEqual([]);
  });
  it("ignores unrelated links", () => {
    expect(classifyLink(el("a", { href: "/pricing" }, "Pricing")).kinds).toEqual([]);
  });
});

describe("package matching", () => {
  it("matches exact names and @scope/* wildcards", () => {
    expect(matchesPackage("posthog-js", ["posthog-js"])).toBe("posthog-js");
    expect(matchesPackage("@sentry/nextjs", ["@sentry/*"])).toBe("@sentry/*");
    expect(matchesPackage("posthog-js-lite", ["posthog-js"])).toBeUndefined();
    expect(matchesPackage("@sentryx/a", ["@sentry/*"])).toBeUndefined();
  });
  it("derives package names from import specifiers", () => {
    expect(importPackageName("posthog-js/react")).toBe("posthog-js");
    expect(importPackageName("@clerk/nextjs/server")).toBe("@clerk/nextjs");
    expect(importPackageName("./local")).toBeNull();
    expect(importPackageName("node:fs")).toBeNull();
  });
});
