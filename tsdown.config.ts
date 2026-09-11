import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const CLIENT_CSS = readFileSync(new URL("./src/client/styles.css", import.meta.url), "utf8");

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
    define: {
      __WSC_CSS__: JSON.stringify(CLIENT_CSS),
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
