import { describe, expect, it } from "vitest";
import { extractHtmlFacts } from "../src/parsers/html.js";
import { extractJsFacts } from "../src/parsers/js.js";

describe("extractJsFacts", () => {
  it("collects imports, requires and dynamic imports", () => {
    const f = extractJsFacts(`import a from "posthog-js";\nconst b = require("stripe");\nimport("mixpanel-browser");`, "x.js");
    expect(f.imports.map((i) => [i.value, i.line])).toEqual([
      ["posthog-js", 1],
      ["stripe", 2],
      ["mixpanel-browser", 3],
    ]);
  });

  it("normalizes window./globalThis. member paths and handles optional chaining", () => {
    const f = extractJsFacts(`window.navigator.geolocation.watchPosition(); navigator?.mediaDevices?.getUserMedia();`, "x.js");
    const paths = f.members.map((m) => m.value);
    expect(paths).toContain("navigator.geolocation.watchPosition");
    expect(paths).toContain("navigator.mediaDevices.getUserMedia");
    expect(paths.some((p) => p.startsWith("window"))).toBe(false);
  });

  it("ignores computed member access with dynamic keys", () => {
    const f = extractJsFacts(`navigator[key].x;`, "x.js");
    expect(f.members.map((m) => m.value)).not.toContain("navigator.key.x");
  });

  it("extracts JSX elements with static and dynamic attrs, and nested text", () => {
    const f = extractJsFacts(`const x = <Link href="/privacy" className={cls}>Our <b>Privacy</b> Policy</Link>;`, "x.tsx");
    const link = f.elements.find((e) => e.name === "Link")!;
    expect(link.attrs.href).toBe("/privacy");
    expect(link.attrs.className).toBe(true);
    expect(link.text).toBe("Our Privacy Policy");
  });

  it("reads attribute values written as {\"...\"} and {`...`}", () => {
    const f = extractJsFacts("<><input type={'email'} /><input autoComplete={`tel`} /></>", "x.jsx");
    expect(f.elements.filter((e) => e.name === "input").map((e) => e.attrs.type ?? e.attrs.autoComplete)).toEqual(["email", "tel"]);
  });

  it("does not see code inside comments", () => {
    const f = extractJsFacts(`// gtag("config")\n/* <input type="email" /> */\nconst a = 1;`, "x.tsx");
    expect(f.calls).toHaveLength(0);
    expect(f.elements).toHaveLength(0);
  });

  it("parses TypeScript generics in .ts files without JSX ambiguity", () => {
    expect(() => extractJsFacts(`const x = <T,>(a: T) => a; const y = <string>z;`, "x.ts")).not.toThrow();
  });

  it("applies a line offset", () => {
    const f = extractJsFacts(`gtag("x")`, "x.js", 9);
    expect(f.calls[0]).toEqual({ value: "gtag", line: 10 });
  });
});

describe("extractHtmlFacts", () => {
  it("records elements with correct line numbers", () => {
    const f = extractHtmlFacts(`<p>\nhello\n</p>\n<input type="email">`, "x.html");
    expect(f.elements.find((e) => e.name === "input")).toMatchObject({ attrs: { type: "email" }, line: 4 });
  });

  it("parses inline scripts with the script's line offset", () => {
    const f = extractHtmlFacts(`<html>\n<head>\n<script>\n  gtag('js');\n</script>`, "x.html");
    expect(f.calls).toContainEqual({ value: "gtag", line: 4 });
  });

  it("exposes attribute values as strings (for script src matching)", () => {
    const f = extractHtmlFacts(`<script src="https://cdn.segment.com/a.js"></script>`, "x.html");
    expect(f.strings.map((s) => s.value)).toContain("https://cdn.segment.com/a.js");
  });

  it("collects link text", () => {
    const f = extractHtmlFacts(`<footer><a href="/p"> Privacy <span>Policy</span></a></footer>`, "x.html");
    expect(f.elements.find((e) => e.name === "a")?.text).toBe("Privacy Policy");
  });

  it("preserves component casing in Vue files and parses <script lang=ts>", () => {
    const f = extractHtmlFacts(`<template><RouterLink to="/privacy">P</RouterLink></template>\n<script setup lang="ts">\nconst a: number = navigator.geolocation ? 1 : 0;\n</script>`, "x.vue");
    expect(f.elements.map((e) => e.name)).toContain("RouterLink");
    expect(f.members).toContainEqual({ value: "navigator.geolocation", line: 3 });
  });

  it("parses Astro frontmatter as TypeScript", () => {
    const f = extractHtmlFacts(`---\nimport posthog from "posthog-js";\n---\n<h1>Hi</h1>`, "x.astro");
    expect(f.imports).toContainEqual({ value: "posthog-js", line: 2 });
  });
});
