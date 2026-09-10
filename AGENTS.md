# AGENTS.md

## Project

dsh-workspace-scope is a Cordis plugin for DeepSeek Harness (DSH) that applies per-workspace policy to Skills already visible to the current Agent and to Host-global MCP servers. Agent/Preset-scoped MCP registrations are outside this plugin's management boundary. The static deployment form is a standard DSH bundle; the `dsh.dynamic` section exists only for hot testing.

Current compatibility baseline: DSH `0.1.5-rc.1`. Read [docs/architecture.md](docs/architecture.md) before changing Skill or Tool integration; it records the upstream ownership and data-flow contracts used by 0.5.

## Common commands (workdir: dsh-workspace-scope/)

- `pnpm run check`: typecheck + tsdown dual build (lib/index.js + lib/client.js)
- `pnpm test`: vitest run. `pnpm run test:coverage`: same, with a v8 coverage report (dynamic.tsx excluded)
- `pnpm run gen:dynamic`: generates the git-ignored `src/client/dynamic.tsx` from `src/client/index.tsx`; run it before hot testing after client changes
- `pnpm run deploy`: `pnpm run prepare` + `dsh plugin --profile web add .` (static deployment, needs user approval)
- Hot test loop: `dev_plugin_build` (compile-dynamic.mjs builds dist/dynamic) then `dev_plugin_load` (new Package + update), then verify in the browser. After a client-half update, a `cordis_run` (run mode restart) is usually needed for the browser to mount it

## Architecture

- Two halves. Host (`src/index.ts`, Node): the first turn-owned `system-prompt/assemble` (identified by its explicit Agent plus turn signal) reads and locks `.dsh-scope.json`. Agent-scoped diagnostic assemblies without a turn signal do not lock the blank session. The Host reconciles the effective Host-global MCP deny set before the model request; when the mask changes it installs the native `agent.ctx.tools.restrict()` mask, discards that pre-policy assembly, and asks DSH to assemble once more so native and PTC presentation are generated under the restriction. A prepended `agent/pre-step` refreshes excluded Skill shadows before DSH `tool-skill` reads the catalog. The Host also owns overview/save endpoints.
- For the shipped Presets targeted by 0.5, DSH uses one Host-held layered `SkillRegistry`. Agent Presets contribute providers/runtime Skills through their standing scope; exact Agents join that preset through scope parentage. Always read the effective Agent view with `skills.snapshot({ scope: agent, cwd, ... })`. An omitted scope is the global layer only and is not a fallback for UI inventory.
- DSH `skill-filesystem` is a provider, not a catalog renderer. DSH `tool-skill` owns the model-facing `skill` loader, explicit `/skill-name` injection, and the durable `skill-catalog` user message generated during `agent/pre-step`. Do not parse, rewrite, or duplicate `<available_skills>`.
- The management UI projects only model-invocable entries when a `skill` Tool resolves for the current Agent. A native `modelInvocable:false` Skill is absent from this UI rather than shown as workspace-disabled.
- Skill refresh runs only while a `skill` Tool resolves for the Agent. It must dispose this plugin's previous runtime shadows before calling `skills.snapshot({ scope: agent })`; otherwise the snapshot sees those `modelInvocable: false` shadows as the winning definitions and cannot rebuild them.
- Skill exclusion preserves the winning definition but shadows only model invocation: `modelInvocable:false`, original `userInvocable`. DSH `tool-skill` then removes it from both the model catalog and `skill` Tool path while still honoring `/skill-name` when the original Skill is user-invocable.
- Post-registration verification recomputes the deny set from the verified snapshot. If a newly visible Skill appears during installation and the policy denies it, the step fails closed instead of publishing an unfiltered catalog.
- MCP reconciliation happens at each real Agent prompt assembly from `tools.schemas()`' global view. Only a change to the effective denied tool-name set replaces the restriction and forces one reassembly; allowed-server inventory changes need no extra work because the current DSH assembly already sees them.
- DSH `ToolRuntime` uses one layered scoped view for schema presentation, lookup, and execution. `tools.restrict()` filters inherited/global tools and leaves exact-scope registrations plus the reserved PTC transport intact. This is why Host-global MCP policy belongs on `agent.ctx.tools.restrict()` and why Agent/Preset-scoped MCP is intentionally outside this plugin's boundary.
- The Host hard-injects `webServer`, `fs`, `skills`, `tools`, `agents`, and `systemPrompt`; `sandboxPolicy` remains optional and is used when available for workspace writes.
- Dual-environment data channel. The dynamic client sandbox forbids import and fetch, so it uses `harness.handle` (host side) with `host.call` (client side); the static bundle uses the webServer routes `/api/dsh-workspace-scope` (GET overview / POST save). The client's `callHost()` switches on `typeof host !== 'undefined'`.
- `dynamic.tsx` is a generated, git-ignored hot-test artifact: `@ts-nocheck` header, `declare const React: any`, `apply(ctx: any)`; `gen-dynamic.mjs` validates the markers and CI verifies that generation succeeds.
- Entry seat: `conversation.input.right`, which DSH renders only once a Session exists. This plugin further limits the chip to blank Sessions. DSH may stage a Preset before that Session exists; by the time our seat renders, the blank Session should have a live Agent composed under the selected Preset.
- A Preset switch can re-parent the same blank Agent without changing the session id. The UI Skill inventory must therefore refresh when the current Session's `projectionValues.agentPreset` changes, not only when the current session id changes. DSH SkillRegistry includes the scope chain in its cache key specifically to make such recomposition visible on the next scoped read.
- The dialog mounts in `shell.overlay`; module-level `modalOpen` plus `modalListeners` shares the open state with the chip.
- Config: `.dsh-scope.json` in the workspace root, `default` key `{mode, skills[], mcps[]}`. `default` means all enabled, `whitelist` stores allowed names, and `blacklist` stores denied names. The UI preserves whitelist/blacklist representation. The first disable from `default` converts it to a blacklist containing only the capabilities the user disabled. The effective config becomes process-local Agent state when the first real prompt assembly begins; later file edits do not mutate that Agent's lock.
- UI inventory is a projection, not configuration ownership. Skill names retained in `.dsh-scope.json` but absent from the current Agent stay hidden and must not be discarded merely because the current Preset cannot see them. Bulk actions operate on the current visible Agent Skill set while preserving hidden entries according to the current mode.
- `activePolicies` is keyed by `agent.id` and stores the locked config, current effective MCP deny key, and separate Skill/MCP disposers. Agent disposal and plugin unload release both registrations.
- Writing the config passes `sandboxPolicy.resolve({ session, mode: 'workspace-write' })` when that optional service is available. Writes are serialized through one plugin-local queue so rapid autosaves cannot land out of order; authoritative config reads wait for the same queue before overview or the first policy lock. Saving is a UI management operation, not bound by the session read-only mode.

## UI conventions

- Chinese copy in the UI, English comments in code.
- Styles use only `--dsw-*` theme tokens (zero hardcoded colors), so a theme switch re-skins automatically. CSS lives as a string array at the top of `index.tsx` (the dynamic sandbox forbids bundler/import; do not switch to an imported CSS file).
- Class prefix `wsc-`. Interactions follow the harness settings plugin-inventory page: collapsible rows with details, search box, collapsible group headings (`data-collapsed` rotates the arrow).
- The Switch is a hand-rolled `button[role=switch]` (the harness has no reusable component): 28x16 track, 12x12 thumb, enabled color and focus ring from `--dsw-alias-state-business-primary`.
- Do not add Persona/Preset source labels, missing/unavailable rows, or warning states for Skills outside the current Agent view. They are simply absent from this policy UI.

## Known trade-offs (read before touching related code)

- DSH `tool-skill` gates its catalog on exact private ToolDefinition identity, while the public `tools.get("skill", agent)` seam can only establish that some `skill` Tool resolves. A custom Preset that shadows `tool-skill` with a same-name Tool is therefore outside exact support until DSH exposes an authoritative public identity/eligibility seam. Do not add schema/description fingerprints or import `tool-skill` internals.
- `ToolSchema` exposes no stable MCP owner metadata and DSH's public MCP tool name is not a reversible identity. Version 0.5 groups at the first `__` after `mcp__`, which supports raw tool names containing `__`; managed MCP `serverName` values containing `__` are outside support. Replace this convention only when DSH exposes stable ownership metadata.
- Agent/Preset-scoped MCP registrations are deliberately not managed. `tools.restrict()` is the supported per-Agent mask for inherited tools and does not mask the exact Agent's own registrations.
- Skill exclusion uses `ctx.skills.register()` to shadow a farther-layer winning Skill. DSH runtime Skill registrations are first-wins within the same exact layer, so an already-registered same-name Agent-local runtime Skill cannot be replaced by this plugin's later shadow. The plugin verifies the resulting scoped catalog after registration and fails that pre-step closed if an excluded Skill is still model-invocable. Do not add a second catalog or execute guard unless the runtime contract changes.
- `AgentPresets.serviceForAgent()` is read addressing for isolated preset-owned services, not a supported mutation seam. Version 0.5 targets the shipped Presets' Host-held SkillRegistry path; custom Presets that isolate their own SkillRegistry are outside support rather than being mutated through `serviceForAgent()`.
- A plugin load/reload that lands after a step's prompt assembly but before its pre-step fails that step closed instead of sending a request assembled without workspace policy. The next real assembly initializes the policy normally.
- Incompatible with `../session-scope` (the old dynamic build): they overwrite each other's `default` key; never run both.
- Playwright background tabs freeze CSS transitions: a transitioning property's computed value overrides inline and important styles, so verifying transform or color transitions needs a temporary `transition:none`.

## Product boundaries (what the plugin does not do)

- Does not install, add, remove, edit, or discover Skill files independently of DSH
- Does not create or edit DSH's Skill catalog or `skill` Tool
- Does not install, add, remove, or edit MCP configs (MCP config stays in Cordis configuration)
- Does not manage Agent/Preset-scoped MCP registrations
- No global on/off or global inventory panel
- No Skill library management