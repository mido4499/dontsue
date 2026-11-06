import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, fixture } from "./helpers.js";

// These run the *built* CLI (`npm test` builds first), so they catch packaging problems too.
const CLI = path.join(ROOT, "dist/cli.js");

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("cli", () => {
  it("exits 0 on a clean project", () => {
    const r = run(fixture("clean-static-site"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("No data collection detected.");
  });

  it("exits 1 when errors are found and prints the issue", () => {
    const r = run(fixture("signup-no-policy"));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("missing-privacy-policy");
    expect(r.stdout).toContain("app/signup/page.tsx:4");
    expect(r.stdout).toContain("Not legal advice");
  });

  it("exits 0 on warnings by default, 1 with --fail-on warn", () => {
    expect(run(fixture("nextjs-pages-router")).code).toBe(0);
    expect(run(fixture("nextjs-pages-router"), "--fail-on", "warn").code).toBe(1);
  });

  it("--fail-on never always exits 0", () => {
    expect(run(fixture("vite-react"), "--fail-on", "never").code).toBe(0);
  });

  it("--format json prints only valid JSON", () => {
    const r = run(fixture("vite-react"), "--format", "json");
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.summary).toEqual({ errors: 2, warnings: 0 });
    expect(report.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints no ANSI color codes when NO_COLOR is set", () => {
    expect(run(fixture("vite-react")).stdout).not.toMatch(/\x1b\[/);
  });

  it("exits 2 on a nonexistent path", () => {
    const r = run(fixture("nope"));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Path not found");
  });

  it("exits 2 on an invalid option value", () => {
    expect(run(".", "--format", "xml").code).toBe(2);
  });

  it("exits 2 on an invalid config file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dontsue-"));
    try {
      writeFileSync(path.join(dir, "dontsue.config.json"), `{ "cookieConsent": "yes" }`);
      const r = run(dir);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain(`"cookieConsent" must be a boolean`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts an explicit --config path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dontsue-"));
    try {
      const cfg = path.join(dir, "custom.json");
      writeFileSync(cfg, JSON.stringify({ privacyPolicyUrl: "https://example.com/p" }));
      expect(run(fixture("signup-no-policy"), "--config", cfg).code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--version and --help exit 0", () => {
    expect(run("--version").stdout.trim()).toBe("0.1.0");
    expect(run("--help").code).toBe(0);
  });
});
