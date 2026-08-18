// Release helper: stamps a version into package.json, archives the
// [Unreleased] CHANGELOG section, runs the full gate, then commits and tags.
// On gate failure it reverts the two written files, so a broken release
// never leaves the tree half-versioned.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = join(root, 'package.json')
const changelogPath = join(root, 'CHANGELOG.md')

const version = process.argv[2]
if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/release.mjs <x.y.z>')
  process.exit(1)
}

const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim()
if (status !== '') {
  console.error('working tree is not clean; aborting')
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
if (pkg.version === version) {
  console.error(`package.json is already at ${version}`)
  process.exit(1)
}
const previousVersion = pkg.version

const changelog = readFileSync(changelogPath, 'utf8')
if (!changelog.includes('## [Unreleased]')) {
  console.error('CHANGELOG.md has no [Unreleased] section')
  process.exit(1)
}

// Stamp version + archive the Unreleased section
pkg.version = version
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
const date = new Date().toISOString().slice(0, 10)
writeFileSync(changelogPath, changelog.replace(
  '## [Unreleased]',
  `## [Unreleased]\n\n## [${version}] - ${date}`,
), 'utf8')

try {
  console.log('running the gate: pnpm run check && pnpm test')
  execSync('pnpm run check', { cwd: root, stdio: 'inherit' })
  execSync('pnpm test', { cwd: root, stdio: 'inherit' })
} catch {
  const rollback = JSON.parse(readFileSync(pkgPath, 'utf8'))
  rollback.version = previousVersion
  writeFileSync(pkgPath, `${JSON.stringify(rollback, null, 2)}\n`, 'utf8')
  writeFileSync(changelogPath, changelog, 'utf8')
  console.error('gate failed; reverted package.json and CHANGELOG.md')
  process.exit(1)
}

execSync('git add package.json CHANGELOG.md', { cwd: root, stdio: 'inherit' })
execSync(`git commit -m "chore: release v${version}"`, { cwd: root, stdio: 'inherit' })
execSync(`git tag v${version}`, { cwd: root, stdio: 'inherit' })
console.log(`released v${version}; push with: git push origin main --follow-tags`)
