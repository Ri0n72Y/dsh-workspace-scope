/** Host-half scope math: which Skill and MCP names are denied per mode. */
import { describe, expect, it } from 'vitest'
import { deniedServers, deniedSkills } from '../src/index'

const SKILLS = ['skill-a', 'skill-b', 'skill-c']
const SERVERS = ['playwright', 'github', 'filesystem']

describe('deniedSkills', () => {
  it('denies nothing in default mode', () => {
    expect(deniedSkills({ mode: 'default', skills: ['skill-a'], mcps: [] }, SKILLS)).toEqual([])
  })

  it('denies names outside the whitelist', () => {
    expect(deniedSkills(
      { mode: 'whitelist', skills: ['skill-a', 'skill-c'], mcps: [] },
      SKILLS,
    )).toEqual(['skill-b'])
  })

  it('ignores stale whitelist and blacklist entries', () => {
    expect(deniedSkills(
      { mode: 'whitelist', skills: ['skill-a', 'gone'], mcps: [] },
      SKILLS,
    )).toEqual(['skill-b', 'skill-c'])
    expect(deniedSkills(
      { mode: 'blacklist', skills: ['skill-b', 'gone'], mcps: [] },
      SKILLS,
    )).toEqual(['skill-b'])
  })
})

describe('deniedServers', () => {
  it('denies nothing in default mode', () => {
    expect(deniedServers({ mode: 'default', skills: [], mcps: [] }, SERVERS)).toEqual([])
  })

  it('denies every installed server outside the whitelist', () => {
    expect(deniedServers(
      { mode: 'whitelist', skills: [], mcps: ['playwright'] },
      SERVERS,
    )).toEqual(['github', 'filesystem'])
  })

  it('denies only installed blacklist entries', () => {
    expect(deniedServers(
      { mode: 'blacklist', skills: [], mcps: ['playwright', 'not-installed'] },
      SERVERS,
    )).toEqual(['playwright'])
  })
})
