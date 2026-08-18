# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
