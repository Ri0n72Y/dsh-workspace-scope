// Generates the import-free dynamic client artifact from the same split source
// modules used by the static bundle. The plugin-dev-loop sandbox provides
// ambient React/host/ctx bindings and does not support module imports.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientDir = join(root, 'src/client')
const outPath = join(clientDir, 'dynamic.tsx')

const modules = [
  'styles.ts',
  'model.ts',
  'transport.ts',
  'modal-state.tsx',
  'components.tsx',
  'scope-modal.tsx',
  'index.tsx',
]

function readModule(file, keepExports) {
  let source = readFileSync(join(clientDir, file), 'utf8').replace(/\r\n/g, '\n')
  // These source files intentionally keep imports on single lines so the
  // dynamic stitcher remains a transparent transform rather than a bundler.
  source = source.replace(/^import .*;\n/gm, '')
  if (!keepExports) source = source.replace(/^export /gm, '')
  return source.trim()
}

const parts = modules.map((file, index) =>
  readModule(file, index === modules.length - 1),
)
let source = parts.join('\n\n')

const applyMarker = 'export function apply(ctx: Context): void {'
if (!source.includes(applyMarker)) {
  throw new Error(`missing marker in stitched client: ${applyMarker}`)
}
source = source.replace(applyMarker, 'export function apply(ctx: any): void {')

if (/^import /m.test(source)) {
  throw new Error('dynamic client still contains an import after stitching')
}

const out = '// @ts-nocheck\n/* eslint-disable */\ndeclare const React: any;\n' + source + '\n'
writeFileSync(outPath, out, 'utf8')
console.log(`generated ${outPath} (${out.length} chars)`)
