import fg from "fast-glob";

export const SOURCE_EXT = /\.(m?[jt]sx?|cjs|cts)$/i;
export const MARKUP_EXT = /\.(html?|vue|svelte|astro)$/i;
export const DOC_EXT = /\.mdx?$/i;

export const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.svelte-kit/**",
  "**/.output/**",
  "**/.vercel/**",
  "**/.turbo/**",
  "**/coverage/**",
  "**/vendor/**",
  "**/*.min.js",
  "**/*.d.ts",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.stories.*",
  "**/__tests__/**",
  "**/__mocks__/**",
];

/** Files larger than this are almost always bundles or generated code. */
export const MAX_FILE_BYTES = 1_000_000;

export async function listFiles(root: string, extraIgnore: string[] = []): Promise<string[]> {
  const files = await fg(["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,html,htm,vue,svelte,astro,md,mdx}", "**/package.json"], {
    cwd: root,
    ignore: [...DEFAULT_IGNORE, ...extraIgnore],
    dot: false,
    onlyFiles: true,
    followSymbolicLinks: false,
  });
  return files.sort();
}
