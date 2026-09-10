// Generates the transient hot-test client from src/client/index.tsx.
//
// The dynamic client half runs in a restricted sandbox (no import, no fetch):
// it must be a bare function body with ambient React/host/ctx bindings. The
// generated src/client/dynamic.tsx is intentionally untracked; run this command
// whenever the plugin-dev-loop needs a fresh hot-test client.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcPath = join(root, 'src/client/index.tsx')
const outPath = join(root, 'src/client/dynamic.tsx')

let src = readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n')

const substitutions = [
  ['import React from "react"', 'declare const React: any'],
  ['import type { Context } from "@deepseek-ai/cordis"', ''],
  ['export function apply(ctx: Context): void {', 'export function apply(ctx: any): void {'],
]
for (const [from, to] of substitutions) {
  if (!src.includes(from)) throw new Error(`missing marker in index.tsx: ${from}`)
  src = src.split(from).join(to)
}

const out = '// @ts-nocheck\n/* eslint-disable */\n' + src
writeFileSync(outPath, out, 'utf8')
console.log(`generated ${outPath} (${out.length} chars)`)
