// Generates the import-free dynamic client artifact from the same split source
// modules used by the static bundle. The plugin-dev-loop sandbox provides
// ambient React/host/ctx bindings and does not support module imports.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src/client')
const outPath = join(clientDir, 'dynamic.tsx')
const css = readFileSync(join(clientDir, 'styles.css'), 'utf8')

const modules = [
  'model.ts',
  'transport.ts',
  'modal-state.tsx',
  'components.tsx',
  'scope-modal.tsx',
  'index.tsx',
]

function readModule(file, keepExports) {
  let source = readFileSync(join(clientDir, file), 'utf8').replace(/\r\n/g, '\n')
  // ponytail: textual stitching assumes one-line imports and unique top-level
  // names; replace it with a real bundler only if that constraint stops holding.
  source = source.replace(/^import .*;\n/gm, '')
  if (!keepExports) source = source.replace(/^export /gm, '')
  return source.trim()
}

const parts = modules.map((file, index) => readModule(file, index === modules.length - 1))
let source = parts.join('\n\n')

const applyMarker = 'export function apply(ctx: Context): void {'
if (!source.includes(applyMarker)) {
  throw new Error(`missing marker in stitched client: ${applyMarker}`)
}
source = source
  .replace('declare const __WSC_CSS__: string;\n', '')
  .replace(applyMarker, 'export function apply(ctx: any): void {')

if (/^import /m.test(source)) {
  throw new Error('dynamic client still contains an import after stitching')
}

const prelude = [
  '// @ts-nocheck',
  '/* eslint-disable */',
  'declare const React: any;',
  'const { useEffect, useId, useRef, useState, useSyncExternalStore } = React;',
  `const __WSC_CSS__ = ${JSON.stringify(css)};`,
  '',
].join('\n')
const out = prelude + source + '\n'

const diagnostics = ts.transpileModule(out, {
  fileName: outPath,
  reportDiagnostics: true,
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2024,
  },
}).diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? []
if (diagnostics.length > 0) {
  throw new Error(`invalid dynamic client: ${diagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n')}`)
}

writeFileSync(outPath, out, 'utf8')
console.log(`generated ${outPath} (${out.length} chars)`)
