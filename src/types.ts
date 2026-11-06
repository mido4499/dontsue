export type Confidence = "high" | "medium" | "low";

export type Category = "pii" | "tracking" | "auth" | "payment" | "location" | "device";

/** What a piece of data collection obliges the app to have. */
export type Requirement = "privacy-policy" | "terms-of-service" | "cookie-consent";

export type Severity = "error" | "warn";

/** Evidence that the app collects personal data. */
export interface Finding {
  ruleId: string;
  category: Category;
  dataTypes: string[];
  file: string;
  line?: number;
  evidence: string;
  confidence: Confidence;
  vendor?: string;
  requires: Requirement[];
}

export interface PolicyEvidence {
  via: "route" | "link" | "config" | "dependency" | "script";
  detail: string;
  file?: string;
  line?: number;
}

export interface PolicyStatus {
  found: boolean;
  evidence: PolicyEvidence[];
}

export interface Policies {
  privacyPolicy: PolicyStatus;
  termsOfService: PolicyStatus;
  cookieConsent: PolicyStatus;
}

export interface Issue {
  id: string;
  severity: Severity;
  message: string;
  fix: string;
  /** ruleIds of the findings that triggered this issue. */
  relatedFindings: string[];
}

export interface SkippedFile {
  file: string;
  reason: string;
}

export interface Report {
  version: string;
  root: string;
  scannedFiles: number;
  durationMs: number;
  findings: Finding[];
  policies: Policies;
  issues: Issue[];
  skipped: SkippedFile[];
  summary: { errors: number; warnings: number };
}

export interface Config {
  /** Privacy policy hosted somewhere the scanner can't see (e.g. a marketing site). */
  privacyPolicyUrl?: string;
  termsUrl?: string;
  /** Set true if consent is handled somewhere the scanner can't see (e.g. a tag manager). */
  cookieConsent?: boolean;
  /** Extra glob patterns to skip, relative to the scan root. */
  ignore?: string[];
  /** Turn individual rules off: { "pii/password-input": "off" } */
  rules?: Record<string, "off">;
}

// ---------------------------------------------------------------------------
// Parser output. Rules work on these "facts", never on raw ASTs, so the same
// rule applies to JSX, HTML, Vue, Svelte and Astro files.
// ---------------------------------------------------------------------------

export interface ElementFact {
  /** Tag or component name as written: "input", "Link", "motion.a". */
  name: string;
  /** String-valued attributes. Dynamic values (`{foo}`) are recorded as `true`. */
  attrs: Record<string, string | true>;
  /** Static text content (used for link text). */
  text: string;
  line: number;
}

export interface LocatedValue {
  value: string;
  line: number;
}

export interface FileFacts {
  file: string;
  elements: ElementFact[];
  /** Static member paths, e.g. "navigator.geolocation.getCurrentPosition". */
  members: LocatedValue[];
  /** Names of plain function calls, e.g. "gtag", "fbq". */
  calls: LocatedValue[];
  /** String literal contents. */
  strings: LocatedValue[];
  /** Module specifiers from import / require / dynamic import. */
  imports: LocatedValue[];
}

export interface DependencyFact {
  name: string;
  version: string;
  file: string;
  line?: number;
}
