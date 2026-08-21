# Contributing

## Development loop

```sh
pnpm install
pnpm run check      # typecheck + dual build (lib/index.js + lib/client.js)
pnpm test           # vitest: node env by default, jsdom specs opt in per file
```

After editing `src/client/index.tsx`, run `pnpm run gen:dynamic` so
`src/client/dynamic.tsx` (the sandbox build of the same code) stays in sync.
CI enforces this with a diff check, so a forgotten regeneration turns red.

Hot testing without a DSH restart: the package declares `dsh.dynamic` for the
plugin-dev-loop dev-loader tools (`dev_plugin_build` to compile,
`dev_plugin_load` to hot-load). Static deployment: `pnpm run deploy`.

## Testing conventions

These mirror the dsh harness rules (docs/testing.md and
packages/client/AGENTS.md):

- Unit tests cover pure logic and edge/error paths; component specs cover
  user-visible behavior.
- The shared vitest environment is node. Browser specs start with a
  `// @vitest-environment jsdom` pragma on the first line.
- Component specs mount through the real plugin entry (`apply` + slots
  registration) and assert visible behavior: dialog content, counts, switch
  states, feedback text. No class-name or internals assertions, no style
  assertions.
- Mock only boundaries: the RPC channel (`host.call`) and framework hooks
  (`useSessions`).
- Tests live in `tests/*.spec.ts(x)`.

## Committing

- One short English message per logical change.
- `pnpm run check` and `pnpm test` must pass locally before pushing.

## Licensing

The project is MIT licensed. By contributing, you agree that your contribution is licensed under the project license (inbound = outbound). No CLA or DCO is required.

## Releasing

Development happens on `main`, where CI runs the full test suite (typecheck,
build, tests, coverage gate). Stable releases ship from the `release` branch:
merging a pull request into `release` triggers the `release` GitHub Actions
workflow — gate → tag `v<package.version>` → npm publish (stable) → GitHub
Release. Every step is idempotent, so re-merging an already-published version
is a safe no-op.

1. Put the release entries under the `## [Unreleased]` heading in
   `CHANGELOG.md` and merge the change into `main`.
2. On `main`, run `node scripts/release.mjs <x.y.z>`: it validates a clean
   tree, stamps the version into `package.json`, archives the Unreleased
   section, re-runs the gate, then commits and tags `v<x.y.z>`. On gate
   failure it reverts the two written files.
3. Push `main` (with the tag): `git push origin main --follow-tags`.
4. Open a pull request from `main` into `release` and merge it. The workflow
   performs the npm publish and GitHub Release automatically.

`release` never receives direct commits: everything reaches it through a
merged pull request from `main`.

npm publishing uses Trusted Publishing (OIDC), with no long-lived npm token.
The npm package's trusted publisher must point to the
`Ri0n72Y/dsh-workspace-scope` GitHub repository and the `release.yml` workflow,
with `npm publish` allowed. The workflow grants `id-token: write` and runs an
OIDC-capable npm CLI before `npm publish`; npm then verifies the GitHub Actions
identity and issues a short-lived publishing credential automatically.
