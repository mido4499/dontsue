// Utility, not a page. Must not count as a privacy policy.
export const redact = (s: string) => s.replace(/./g, "*");
