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

- Two halves. Host (`src/index.ts`, Node): `agent/session-start` uses `Agent.runMaintenance()` to read and lock `.dsh-scope.json` and install the Host-global MCP `tools.restrict()` mask before the first prompt assembly. A prepended `agent/pre-step` refreshes only excluded Skill shadows before DSH's `tool-skill` catalog listener. `tools/change` refreshes MCP restrictions only when the Host-global MCP inventory actually changes. The Host also owns overview/save endpoints.
- The Host hard-injects `webServer`, `fs`, `skills`, `tools`, and `agents`; `sandboxPolicy` remains optional and is used when available for workspace writes.
- Dual-environment data channel. The dynamic client sandbox forbids import and fetch, so it uses `harness.handle` (host side) with `host.call` (client side); the static bundle uses the webServer routes `/api/dsh-workspace-scope` (GET overview / POST save). The client's `callHost()` switches on `typeof host !== 'undefined'`.
- `dynamic.tsx` is a generated script artifact: `@ts-nocheck` header, `declare const React: any`, `apply(ctx: any)`; everything else must match `index.tsx`. `gen-dynamic.mjs` validates the markers and fails loudly if any is missing.
- Entry seat: the new-session screen only, `conversation.input.right` (compact chip, rendered when the current session is blank). Ongoing conversations never show the entry: the config is locked at conversation start, so UI changes only shape later sessions. The dialog mounts in `shell.overlay`; module-level `modalOpen` plus `modalListeners` shares the open state with the chip.
- Config: `.dsh-scope.json` in the workspace root, `default` key `{mode, skills[], mcps[]}`. The UI always saves `whitelist` (checked means enabled); reading accepts legacy `default` / `blacklist`.
- `activePolicies` is keyed by `agent.id` and stores the locked config plus separate Skill/MCP disposers. Agent disposal and plugin unload release both. On plugin reload, existing idle Agents are initialized immediately and running Agents after `whenIdle()`.
- Writing the config must pass `sandboxPolicy.resolve({ session, mode: 'workspace-write' })` explicitly when that optional service is available. Writes are serialized through one plugin-local queue so rapid autosaves cannot land out of order. Saving is a UI management operation, not bound by the session read-only mode.

## UI conventions

- Chinese copy in the UI, English comments in code.
- Styles use only `--dsw-*` theme tokens (zero hardcoded colors), so a theme switch re-skins automatically. CSS lives as a string array at the top of `index.tsx` (the dynamic sandbox forbids bundler/import; do not switch to an imported CSS file).
- Class prefix `wsc-`. Interactions follow the harness settings plugin-inventory page: collapsible rows with details, search box, collapsible group headings (`data-collapsed` rotates the arrow).
- The Switch is a hand-rolled `button[role=switch]` (the harness has no reusable component): 28x16 track, 12x12 thumb, enabled color and focus ring from `--dsw-alias-state-business-primary`.

## Known trade-offs (read before touching related code)

- Global MCP inventory is derived from DSH's public `mcp__<server>__<tool>` naming contract. Current DSH validates `<server>` as `[A-Za-z0-9_-]{1,32}`, so delimiter parsing is exact; `ToolSchema` still exposes no stable MCP owner metadata. Replace the name-based inventory only when DSH exposes a stable ownership seam.
- Agent/Preset-scoped MCP registrations are deliberately not managed. `tools.restrict()` is the supported per-Agent mask for inherited global tools and does not mask scoped registrations.
- Incompatible with `../session-scope` (the old dynamic build): they overwrite each other's `default` key; never run both.
- Playwright background tabs freeze CSS transitions: a transitioning property's computed value overrides inline and important styles, so verifying transform or color transitions needs a temporary `transition:none`.

## Product boundaries (what the plugin does not do)

- Does not install, add, remove, or edit MCP or Skill configs (MCP config stays in Cordis configuration)
- Does not manage Agent/Preset-scoped MCP registrations
- No global on/off or global inventory panel
- No Skill library management
