import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const CSS_MODULE_ID = "\0workspace-scope-css-module";

function scopedClass(local: string): string {
  return `wsc-${local.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`;
}

function compileCssModule(source: string): { css: string; classes: Record<string, string> } {
  const names = new Set<string>();
  const css = source.replace(/\.([A-Za-z_][\w-]*)/g, (_match, local: string) => {
    names.add(local);
    return `.${scopedClass(local)}`;
  });
  return {
    css,
    classes: Object.fromEntries([...names].map((name) => [name, scopedClass(name)])),
  };
}

const { css: CLIENT_CSS, classes: CLIENT_CLASSES } = compileCssModule(
  readFileSync(new URL("./src/client/styles.module.css", import.meta.url), "utf8"),
);

// ponytail: this package owns one controlled CSS Module. If it grows into
// multiple sheets or needs richer module semantics, use DSH/@tsdown/css
// instead of extending this tiny transform into a CSS toolchain.
function clientCssModule() {
  return {
    name: "workspace-scope-css-module",
    resolveId: {
      order: "pre" as const,
      handler(source: string) {
        return source === "./styles.module.css" ? CSS_MODULE_ID : null;
      },
    },
    load(id: string) {
      if (id !== CSS_MODULE_ID) return null;
      return [
        `const css = ${JSON.stringify(CLIENT_CSS)};`,
        `const classes = ${JSON.stringify(CLIENT_CLASSES)};`,
        'const tagId = "dsh-workspace-scope/styles.module.css";',
        "if (typeof document !== \"undefined\" && document.querySelector('style[data-plugin-css=\"' + tagId + '\"]') === null) {",
        '  const tag = document.createElement("style");',
        '  tag.dataset.plugin = "workspace-scope";',
        "  tag.dataset.pluginCss = tagId;",
        "  tag.textContent = css;",
        "  document.head.appendChild(tag);",
        "}",
        "export default classes;",
      ].join("\n");
    },
  };
}

/**
 * Platform modules the browser module table shares (mirrors
 * packages/client/web/src/platform.ts in the harness repo, plus the runtime
 * client exemption). Client bundle code may only import these at runtime.
 */
const CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-web-react",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-attachment",
  "@deepseek-ai/dsh-client-schema-form",
  "@deepseek-ai/dsh-client-runtime/client",
];

export default defineConfig([
  {
    name: "dsh-workspace-scope",
    entry: ["src/index.ts"],
    outDir: "lib",
    format: ["esm"],
    platform: "node",
    target: "es2024",
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: "dsh-workspace-scope/client",
    entry: { client: "src/client/index.tsx" },
    outDir: "lib",
    format: "cjs",
    platform: "browser",
    target: "es2024",
    dts: false,
    clean: false,
    sourcemap: true,
    deps: { neverBundle: CLIENT_EXTERNALS },
    plugins: [clientCssModule()],
    define: {
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
    },
    outputOptions: {
      entryFileNames: "client.js",
      banner: 'window.__ModuleLoader__.load({ id: "dsh-workspace-scope", factory: (require) => {',
      footer: "return module.exports; } });",
      intro: "var module = { exports: {} }; var exports = module.exports;",
    },
  },
]);
