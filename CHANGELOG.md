# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.4.0] - 2026-09-02

### Changed
- Skill scoping now uses DSH's native per-agent `SkillRegistry` layers: excluded model-invocable skills are shadowed in the agent scope with `modelInvocable: false` while preserving their original user-invocation policy.
- MCP scoping continues to use the native scoped `tools.restrict()` path and is explicitly limited to Host-global MCP tools inherited by the Agent; Agent/Preset-scoped MCP registrations stay outside this plugin's management boundary.
- Workspace config is now read and locked at `agent/session-start`. `Agent.runMaintenance()` installs the Host-global MCP restriction before the first prompt assembly, matching DSH 0.1.2-rc.1's assembly-before-pre-step ordering.
- The prepended `agent/pre-step` listener now refreshes only Skill shadows, immediately before DSH's `tool-skill` catalog listener consumes the scoped SkillRegistry.
- Host-global MCP restrictions now refresh from `tools/change` only when the global MCP inventory changes. Restriction-originated notifications keep the same inventory key and therefore do not recurse or cause redundant rebuilds.
- The Host declares its actual hard service dependencies: `webServer`, `fs`, `skills`, `tools`, and `agents`; `sandboxPolicy` remains optional.
- Saving `.dsh-scope.json` does not mutate an active Agent's locked config. UI changes apply to later conversations only.
- The management overview inventories every discovered Skill and Host-global MCP server; `.dsh-scope.json` independently supplies each row's enabled/disabled switch state, so an existing capability remains visible in the UI even when it is excluded from model use.

### Fixed
- Plugin unload/HMR disposes capability policies installed into live Agent scopes. On reload, existing idle Agents are initialized immediately and running Agents after they become idle.
- Workspace config writes are serialized so rapid autosaves cannot complete out of order and roll `.dsh-scope.json` back to an older switch state.
- Agent disposal consumes DSH's `{ agent }` event payload correctly, so a resumed/recreated Agent with the same session id does not inherit a stale `activePolicies` entry.
- Host-global MCP restrictions no longer arrive one model request late under current DSH: they are present before `systemPrompt.assemble()` builds `assembly.tools` and PTC/native tool presentation.
- MCP server grouping now follows DSH's exact public-name contract, including the `[A-Za-z0-9_-]{1,32}` server-name constraint, removing the old delimiter-ambiguity assumption.

### Removed
- Removed the custom `skill-catalog` message renderer/filter, the full-`source.entries` digest workaround, and the extra `tools/pre-execute` Skill deny guard.
- Removed the catalog-waterfall compatibility test suite that existed only for the old interception path.

## [0.3.2] - 2026-08-21

### Fixed
- Completed the `workspace-scope` → `dsh-workspace-scope` rename across the bundle metadata, host/client module references, and static API prefix, so the browser client and host now agree on `/api/dsh-workspace-scope`.
- Updated the generated dynamic client substitutions and integration tests to follow the renamed API routes.
- Replaced `URL` / `URLSearchParams`-dependent request parsing in the host route handler with sandbox-safe parsing, so overview/save requests work in DSH dynamic plugin environments where those globals are unavailable.

## [0.3.1] - 2026-08-18

### Fixed
- npm metadata (repository / homepage / bugs) now points at the renamed `Ri0n72Y/dsh-workspace-scope` repository instead of the old `workspace-scope` URL.

## [0.3.0] - 2026-08-18

### Added
- `release` GitHub Actions workflow: pushing the `release` branch gates, tags `v<version>`, publishes to npm (stable, via the `NPM_TOKEN` secret), and creates the GitHub Release. Idempotent, so re-pushing an already-published version is a no-op.

### Fixed
- The trimmed catalog keeps the full `source.entries` on the rebuilt message (only the visible text is trimmed), so tool-skill's digest-based stability check stays satisfied and no catalog is re-injected on later steps. Previously every user message triggered a full catalog reload (tool-skill saw the trimmed entries, compared their digest against the full snapshot, and republished every step), wasting tokens per turn.

## [0.2.0] - 2026-08-18

### Fixed
- The skill catalog trim runs as an outermost (prepend) pre-step listener, so the full catalog tool-skill appends at the end of the waterfall is filtered too. Previously the trim ran before tool-skill's append and new conversations still saw the full catalog.
- The trim listener reads the authoritative per-conversation lock (`appliedConfigs`) before the UI-shared cache, so a concurrent overview fetch cannot swap the config for a running conversation even for one step.
- A trimmed update catalog keeps its `update` marker, so downstream readers can still tell an initial catalog from a replacement.

### Added
- Host behavior specs through the real apply(): webServer routes (overview/save/405/404), per-pre-step MCP restriction with the per-conversation lock, and the tools/pre-execute deny guard.
- Coverage gate (`pnpm run test:coverage`, thresholds: 85% lines / 65% branches, enforced in CI) and a Windows CI matrix.
- Waterfall regression specs for update-form trims, mid-chain reject/abort propagation, and first-step veto degradation (the trim stays a safe no-op when the inner config listener is skipped).
- Every dialog change saves immediately (no save button left; enable all / disable all remain as quick actions).
- The dialog copy states the effect boundaries explicitly: the scope applies at new-conversation start only, and the `/skill-name` gesture keeps working in any conversation.
- The scope entry is hero-only: the chip shows on the new-session screen, and ongoing conversations show nothing (their config is locked at conversation start).
- Tab / Shift+Tab focus is trapped inside the dialog (wrap at the first and last focusable).
- Host scope math (`deniedServers`, `keptSkillNames`) is exported as pure functions with direct unit tests; legacy blacklist display and search reset on reopen are covered by behavior specs (30 specs total).

## [0.1.0] - 2026-08-16

### Added
- Per-workspace Skill and MCP enablement, stored in `.dsh-scope.json` (whitelist semantics; legacy default/blacklist configs read compatibly).
- Dialog on the new-session screen: search box, collapsible groups, per-row switches with expandable details, enable all / disable all / save.
- Session lock: the config applies to new conversations only; the `/skill-name` gesture still loads excluded skills.
- Dual data channel: static webServer routes plus dynamic sandbox RPC for hot testing.
- Test suite (vitest), GitHub Actions CI, bilingual README with a data-flow diagram, English AGENTS.md, CONTRIBUTING.
