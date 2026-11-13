import type { Finding, Issue, Policies, Requirement } from "./types.js";

const LABEL: Record<string, string> = {
  pii: "personal data",
  tracking: "tracking",
  auth: "user accounts",
  payment: "payments",
  location: "location",
  device: "camera/microphone",
  ai: "AI providers",
  email: "email providers",
};

/** Vendors that receive user data from the app's own code (not trackers). */
function processors(findings: Finding[]): string[] {
  return uniq(findings.filter((f) => (f.category === "ai" || f.category === "email") && f.vendor).map((f) => f.vendor!)).sort();
}

/** ["a"] -> "a", ["a","b"] -> "a and b", ["a","b","c"] -> "a, b and c" */
function listJoin(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function needing(findings: Finding[], req: Requirement): Finding[] {
  return findings.filter((f) => f.confidence !== "low" && f.requires.includes(req));
}

function describe(findings: Finding[]): string {
  const dataTypes = uniq(findings.flatMap((f) => f.dataTypes)).slice(0, 6);
  return dataTypes.join(", ");
}

/** Turn findings + policy status into issues. */
export function evaluate(findings: Finding[], policies: Policies): Issue[] {
  const issues: Issue[] = [];

  // 1. Personal data without a privacy policy.
  const privacyNeeded = needing(findings, "privacy-policy");
  if (privacyNeeded.length && !policies.privacyPolicy.found) {
    const high = privacyNeeded.some((f) => f.confidence === "high");
    const shared = processors(privacyNeeded);
    const sharing = shared.length ? ` and shares it with ${listJoin(shared)}` : "";
    issues.push({
      id: "missing-privacy-policy",
      severity: high ? "error" : "warn",
      message: `App collects personal data (${describe(privacyNeeded)})${sharing}, but no privacy policy route, page, or link was found.`,
      fix: `Add a privacy policy page (e.g. /privacy) that discloses each data type and third party, and link it from your footer and signup forms. If it's hosted elsewhere, set "privacyPolicyUrl" in dontsue.config.json.`,
      relatedFindings: uniq(privacyNeeded.map((f) => f.ruleId)),
    });
  }

  // 2. Privacy page exists but nothing links to it.
  if (privacyNeeded.length && policies.privacyPolicy.found) {
    const linked = policies.privacyPolicy.evidence.some((e) => e.via === "link" || e.via === "config");
    if (!linked) {
      issues.push({
        id: "privacy-policy-not-linked",
        severity: "warn",
        message: "A privacy policy page exists, but no link to it was found. Users must be able to find it.",
        fix: "Link the privacy policy from every page (usually the footer) and next to forms that collect data.",
        relatedFindings: [],
      });
    }
  }

  // 3. Trackers without a consent mechanism.
  const consentNeeded = needing(findings, "cookie-consent");
  if (consentNeeded.length && !policies.cookieConsent.found) {
    const high = consentNeeded.some((f) => f.confidence === "high");
    const vendors = uniq(consentNeeded.map((f) => f.vendor ?? f.ruleId));
    issues.push({
      id: "tracking-without-consent",
      severity: high ? "error" : "warn",
      message: `Trackers (${vendors.join(", ")}) load without a consent mechanism. Required for EU/UK users (GDPR, ePrivacy).`,
      fix: `Add a consent banner and load trackers only after the user opts in. If consent is handled elsewhere (e.g. in a tag manager), set "cookieConsent": true in dontsue.config.json.`,
      relatedFindings: uniq(consentNeeded.map((f) => f.ruleId)),
    });
  }

  // 4. Accounts or payments without terms. Not usually legally required, hence a warning.
  const termsNeeded = needing(findings, "terms-of-service");
  if (termsNeeded.length && !policies.termsOfService.found) {
    const cats = uniq(termsNeeded.map((f) => LABEL[f.category] ?? f.category)).join(" and ");
    issues.push({
      id: "missing-terms-of-service",
      severity: "warn",
      message: `App has ${cats} but no terms of service were found.`,
      fix: `Terms aren't usually required by law, but payment providers and app stores often require them, and they limit your liability. Add a /terms page or set "termsUrl" in dontsue.config.json.`,
      relatedFindings: uniq(termsNeeded.map((f) => f.ruleId)),
    });
  }

  return issues;
}
