# AGENTS.md

## Project

workspace-scope is a Cordis plugin for DeepSeek Harness (DSH) that turns Skills and MCP servers on and off per workspace, controlling the startup context of new sessions. The static deployment form is a standard DSH bundle; the `dsh.dynamic` section exists only for hot testing.

## Common commands (workdir: workspace-scope/)

- `pnpm run check`: typecheck + tsdown dual build (lib/index.js + lib/client.js)
- `pnpm test`: vitest run. `pnpm run test:coverage`: same, with a v8 coverage report (dynamic.tsx excluded)
- `pnpm run gen:dynamic`: generates src/client/dynamic.tsx from src/client/index.tsx. Required after every client source change
- `pnpm run deploy`: `pnpm run prepare` + `dsh plugin --profile web add .` (static deployment, needs user approval)
- Hot test loop: `dev_plugin_build` (compile-dynamic.mjs builds dist/dynamic) then `dev_plugin_load` (new Package + update), then verify in the browser. After a client-half update, a `cordis_run` (run mode restart) is usually needed for the browser to mount it

## Architecture

- Two halves. Host (src/index.ts, Node): pre-step trims the skill catalog message per workspace config, `agent.ctx.tools.restrict` trims MCP tools, `tools/pre-execute` is the fallback that blocks excluded skills, plus the overview/save endpoints. Client (src/client/index.tsx, browser): entry bar and dialog.
- Dual-environment data channel. The dynamic client sandbox forbids import and fetch, so it uses `harness.handle` (host side) with `host.call` (client side); the static bundle uses the webServer routes `/api/workspace-scope` (GET overview / POST save). The client's callHost() switches on `typeof host !== 'undefined'`.
- dynamic.tsx is a script artifact: @ts-nocheck header, `declare const React: any`, `apply(ctx: any)`; everything else must match index.tsx byte for byte. gen-dynamic.mjs validates the markers and fails loudly if any is missing.
- Entry seat: the new-session screen only, conversation.input.right (compact chip, rendered when the current session is blank). Ongoing conversations never show the entry: the scope is locked in at conversation start, so it only shapes new sessions. The dialog mounts in shell.overlay; module-level modalOpen plus modalListeners shares the open state with the chip.
- Config: .dsh-scope.json in the workspace root, `default` key {mode, skills[], mcps[]}. The UI always saves `whitelist` (checked means enabled); reading accepts legacy default/blacklist. Session lock: appliedConfigs per agent.id locks at the first pre-step, so changing the config does not affect started conversations.
- Writing the config must pass `sandboxPolicy.resolve({ session, mode: 'workspace-write' })` explicitly. Saving is a UI management operation, not bound by the session read-only mode.

## UI conventions

- Chinese copy in the UI, English comments in code.
- Styles use only `--dsw-*` theme tokens (zero hardcoded colors), so a theme switch re-skins automatically. CSS lives as a string array at the top of index.tsx (the dynamic sandbox forbids bundler/import; do not switch to an imported CSS file).
- Class prefix `wsc-`. Interactions follow the harness settings plugin-inventory page: collapsible rows with details, search box, collapsible group headings (data-collapsed rotates the arrow).
- The Switch is a hand-rolled `button[role=switch]` (the harness has no reusable component): 28x16 track, 12x12 thumb, enabled color and focus ring from `--dsw-alias-state-business-primary`.

## Known trade-offs (read before touching related code)

- The trimmed catalog keeps the FULL source.entries on the rebuilt message (only the visible text is trimmed to the enabled set). tool-skill's stability check digests the last model-visible catalog message, so keeping entries full keeps its digest equal to the snapshot and no catalog is re-injected on later steps. A republish only happens when the skill set actually changes.
- With `DSH_TOOLS_MODE=code` the MCP part silently does nothing (serverToolsMap is empty); `native` and `both` work.
- Incompatible with ../session-scope (the old dynamic build): they overwrite each other's `default` key; never run both.
- Playwright background tabs freeze CSS transitions: a transitioning property's computed value overrides inline and important styles, so verifying transform or color transitions needs a temporary `transition:none`.

## Product boundaries (what the plugin does not do)

- Does not install, add, remove, or edit MCP or skill configs (MCP config stays in cordis.patch.yml)
- No global on/off, no global inventory panel
- No skill library management
