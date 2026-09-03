# AGENTS.md

## Project

dsh-workspace-scope is a Cordis plugin for DeepSeek Harness (DSH) that turns Skills and Host-global MCP servers on and off per workspace, controlling which capabilities new sessions expose to the model. Agent/Preset-scoped MCP registrations are outside this plugin's management boundary. The static deployment form is a standard DSH bundle; the `dsh.dynamic` section exists only for hot testing.

## Common commands (workdir: dsh-workspace-scope/)

- `pnpm run check`: typecheck + tsdown dual build (lib/index.js + lib/client.js)
- `pnpm test`: vitest run. `pnpm run test:coverage`: same, with a v8 coverage report (dynamic.tsx excluded)
- `pnpm run gen:dynamic`: generates src/client/dynamic.tsx from src/client/index.tsx. Required after every client source change
- `pnpm run deploy`: `pnpm run prepare` + `dsh plugin --profile web add .` (static deployment, needs user approval)
- Hot test loop: `dev_plugin_build` (compile-dynamic.mjs builds dist/dynamic) then `dev_plugin_load` (new Package + update), then verify in the browser. After a client-half update, a `cordis_run` (run mode restart) is usually needed for the browser to mount it

## Architecture

- Two halves. Host (`src/index.ts`, Node): the first turn-owned `system-prompt/assemble` (identified by its Agent plus turn signal) reads and locks `.dsh-scope.json`. Agent-scoped diagnostic assemblies without a turn signal do not lock the blank session. The Host reconciles the effective Host-global MCP deny set before the model request; when the mask changes it installs the native `agent.ctx.tools.restrict()` mask, discards that pre-policy assembly, and asks DSH to assemble once more so both native and PTC presentation are generated under the restriction. A prepended `agent/pre-step` refreshes excluded Skill shadows immediately before DSH's `tool-skill` catalog listener. The Host also owns overview/save endpoints.
- Skill refresh must dispose the plugin's previous runtime shadows before calling `skills.snapshot({ scope: agent })`. Otherwise the snapshot sees those `modelInvocable: false` shadows as the winning definitions and cannot rebuild them; disposing them afterwards would expose the original Skills on the next step.
- MCP reconciliation happens at each real Agent prompt assembly from `tools.schemas()`' global view. Only a change to the effective denied tool-name set replaces the restriction and forces one reassembly; allowed-server inventory changes need no extra work because the current DSH assembly already sees them.
- The Host hard-injects `webServer`, `fs`, `skills`, `tools`, `agents`, and `systemPrompt`; `sandboxPolicy` remains optional and is used when available for workspace writes.
- Dual-environment data channel. The dynamic client sandbox forbids import and fetch, so it uses `harness.handle` (host side) with `host.call` (client side); the static bundle uses the webServer routes `/api/dsh-workspace-scope` (GET overview / POST save). The client's `callHost()` switches on `typeof host !== 'undefined'`.
- `dynamic.tsx` is a generated script artifact: `@ts-nocheck` header, `declare const React: any`, `apply(ctx: any)`; everything else must match `index.tsx`. `gen-dynamic.mjs` validates the markers and fails loudly if any is missing.
- Entry seat: the new-session screen only, `conversation.input.right` (compact chip, rendered when the current session is blank). Ongoing conversations never show the entry. The dialog mounts in `shell.overlay`; module-level `modalOpen` plus `modalListeners` shares the open state with the chip.
- Config: `.dsh-scope.json` in the workspace root, `default` key `{mode, skills[], mcps[]}`. The UI always saves `whitelist` (checked means enabled); reading accepts legacy `default` / `blacklist`. The effective config becomes process-local Agent state when the first real prompt assembly begins; later file edits do not mutate that Agent's lock.
- `activePolicies` is keyed by `agent.id` and stores the locked config, current effective MCP deny key, and separate Skill/MCP disposers. Agent disposal and plugin unload release both registrations.
- Writing the config passes `sandboxPolicy.resolve({ session, mode: 'workspace-write' })` when that optional service is available. Writes are serialized through one plugin-local queue so rapid autosaves cannot land out of order. Saving is a UI management operation, not bound by the session read-only mode.

## UI conventions

- Chinese copy in the UI, English comments in code.
- Styles use only `--dsw-*` theme tokens (zero hardcoded colors), so a theme switch re-skins automatically. CSS lives as a string array at the top of `index.tsx` (the dynamic sandbox forbids bundler/import; do not switch to an imported CSS file).
- Class prefix `wsc-`. Interactions follow the harness settings plugin-inventory page: collapsible rows with details, search box, collapsible group headings (`data-collapsed` rotates the arrow).
- The Switch is a hand-rolled `button[role=switch]` (the harness has no reusable component): 28x16 track, 12x12 thumb, enabled color and focus ring from `--dsw-alias-state-business-primary`.

## Known trade-offs (read before touching related code)

- Global MCP inventory is derived from DSH's public `mcp__<server>__<tool>` naming contract. Current DSH validates `<server>` as `[A-Za-z0-9_-]{1,32}`, so delimiter parsing is exact; `ToolSchema` still exposes no stable MCP owner metadata. Replace the name-based inventory only when DSH exposes a stable ownership seam.
- Agent/Preset-scoped MCP registrations are deliberately not managed. `tools.restrict()` is the supported per-Agent mask for inherited global tools and does not mask scoped registrations.
- Skill exclusion uses `ctx.skills.register()` to shadow a farther-layer winning Skill. DSH runtime Skill registrations are first-wins within the same exact layer, so an already-registered same-name Agent-local runtime Skill cannot be replaced by this plugin's later shadow. The plugin verifies the resulting scoped catalog after registration and fails that pre-step closed if an excluded Skill is still model-invocable. Do not add a second catalog or execute guard unless the runtime contract changes.
- A plugin load/reload that lands after a step's prompt assembly but before its pre-step fails that step closed instead of sending a request assembled without workspace policy. The next real assembly initializes the policy normally.
- Incompatible with `../session-scope` (the old dynamic build): they overwrite each other's `default` key; never run both.
- Playwright background tabs freeze CSS transitions: a transitioning property's computed value overrides inline and important styles, so verifying transform or color transitions needs a temporary `transition:none`.

## Product boundaries (what the plugin does not do)

- Does not install, add, remove, or edit MCP or Skill configs (MCP config stays in Cordis configuration)
- Does not manage Agent/Preset-scoped MCP registrations
- No global on/off or global inventory panel
- No Skill library management
