/**
 * Host-half config parsing. The legacy/default/blacklist reading semantics
 * are the most regression-prone logic in the host half, so the pure parser
 * gets direct unit coverage (no fs, no ctx mocks needed).
 */
import { describe, expect, it } from 'vitest'
import { parseScopeConfig } from '../src/index'

describe('parseScopeConfig', () => {
  it('degrades to defaults when the document is missing or empty', () => {
    expect(parseScopeConfig(undefined)).toEqual({ mode: 'default', skills: [], mcps: [] })
    expect(parseScopeConfig('')).toEqual({ mode: 'default', skills: [], mcps: [] })
  })

  it('degrades to defaults on malformed JSON', () => {
    expect(parseScopeConfig('{not json')).toEqual({ mode: 'default', skills: [], mcps: [] })
    expect(parseScopeConfig('42')).toEqual({ mode: 'default', skills: [], mcps: [] })
    expect(parseScopeConfig('"str"')).toEqual({ mode: 'default', skills: [], mcps: [] })
    expect(parseScopeConfig('null')).toEqual({ mode: 'default', skills: [], mcps: [] })
  })

  it('reads a whitelist config', () => {
    const cfg = parseScopeConfig(JSON.stringify({
      default: { mode: 'whitelist', skills: ['skill-a', 'skill-b'], mcps: ['playwright'] },
    }))
    expect(cfg).toEqual({ mode: 'whitelist', skills: ['skill-a', 'skill-b'], mcps: ['playwright'] })
  })

  it('preserves the legacy blacklist mode', () => {
    const cfg = parseScopeConfig(JSON.stringify({
      default: { mode: 'blacklist', skills: ['skill-a'], mcps: [] },
    }))
    expect(cfg.mode).toBe('blacklist')
    expect(cfg.skills).toEqual(['skill-a'])
  })

  it('normalizes an unknown mode to default', () => {
    const cfg = parseScopeConfig(JSON.stringify({
      default: { mode: 'fancy', skills: ['skill-a'], mcps: [] },
    }))
    expect(cfg.mode).toBe('default')
    expect(cfg.skills).toEqual(['skill-a'])
  })

  it('degrades when the default key is missing or not an object', () => {
    expect(parseScopeConfig(JSON.stringify({ other: 1 }))).toEqual({ mode: 'default', skills: [], mcps: [] })
    expect(parseScopeConfig(JSON.stringify({ default: 'nope' }))).toEqual({ mode: 'default', skills: [], mcps: [] })
    expect(parseScopeConfig(JSON.stringify({ default: [1, 2] }))).toEqual({ mode: 'default', skills: [], mcps: [] })
  })

  it('keeps only string entries and only array shapes', () => {
    const cfg = parseScopeConfig(JSON.stringify({
      default: {
        mode: 'whitelist',
        skills: ['a', 42, null, 'b', { x: 1 }],
        mcps: 'not-an-array',
      },
    }))
    expect(cfg.skills).toEqual(['a', 'b'])
    expect(cfg.mcps).toEqual([])
  })

  it('ignores document-level keys outside default (legacy dynamic-build format)', () => {
    // The old dynamic build wrote {disabledSkills, disabledMcp}; that shape
    // must degrade safely to everything enabled, not crash or leak.
    const cfg = parseScopeConfig(JSON.stringify({
      disabledSkills: ['skill-a'],
      disabledMcp: ['playwright'],
    }))
    expect(cfg).toEqual({ mode: 'default', skills: [], mcps: [] })
  })
})
