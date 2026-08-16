/**
 * Host-half scope math: which skills survive the catalog trim and which MCP
 * servers get denied, per config mode. Pure functions, direct unit coverage.
 */
import { describe, expect, it } from 'vitest'
import { deniedServers, keptSkillNames } from '../src/index'

const SKILLS = ['skill-a', 'skill-b', 'skill-c']
const SERVERS = ['playwright', 'github', 'filesystem']

describe('keptSkillNames', () => {
  it('keeps everything in default mode', () => {
    expect(keptSkillNames({ mode: 'default', skills: [], mcps: [] }, SKILLS)).toBeNull()
    // even an explicit skills list is ignored in default mode
    expect(keptSkillNames({ mode: 'default', skills: ['skill-a'], mcps: [] }, SKILLS)).toBeNull()
  })

  it('filters to the whitelist in whitelist mode', () => {
    const cfg = { mode: 'whitelist' as const, skills: ['skill-a', 'skill-c'], mcps: [] }
    expect(keptSkillNames(cfg, SKILLS)).toEqual(['skill-a', 'skill-c'])
  })

  it('keeps only names that exist in the catalog (whitelist entries may be stale)', () => {
    const cfg = { mode: 'whitelist' as const, skills: ['skill-a', 'gone'], mcps: [] }
    expect(keptSkillNames(cfg, SKILLS)).toEqual(['skill-a'])
  })

  it('excludes the blacklist in blacklist mode', () => {
    const cfg = { mode: 'blacklist' as const, skills: ['skill-b'], mcps: [] }
    expect(keptSkillNames(cfg, SKILLS)).toEqual(['skill-a', 'skill-c'])
  })

  it('handles an empty catalog', () => {
    expect(keptSkillNames({ mode: 'whitelist', skills: ['skill-a'], mcps: [] }, [])).toEqual([])
    expect(keptSkillNames({ mode: 'blacklist', skills: [], mcps: [] }, [])).toEqual([])
  })
})

describe('deniedServers', () => {
  it('denies nothing in default mode', () => {
    expect(deniedServers({ mode: 'default', skills: [], mcps: [] }, SERVERS)).toEqual([])
  })

  it('denies every installed server not on the whitelist', () => {
    const cfg = { mode: 'whitelist' as const, skills: [], mcps: ['playwright'] }
    expect(deniedServers(cfg, SERVERS)).toEqual(['github', 'filesystem'])
  })

  it('denies only the excluded servers in blacklist mode, limited to installed ones', () => {
    const cfg = { mode: 'blacklist' as const, skills: [], mcps: ['playwright', 'not-installed'] }
    expect(deniedServers(cfg, SERVERS)).toEqual(['playwright'])
  })

  it('denies nothing when the whitelist covers all installed servers', () => {
    const cfg = { mode: 'whitelist' as const, skills: [], mcps: ['playwright', 'github', 'filesystem'] }
    expect(deniedServers(cfg, SERVERS)).toEqual([])
  })
})
