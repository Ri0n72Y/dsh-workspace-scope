// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getAgentService } from '../src/host/scoped-service'

describe('getAgentService', () => {
  it('resolves through ctx.get without touching the raw service property', () => {
    const service = { register() {} }
    const ctx = {
      get(name: string) {
        return name === 'skills' ? service : undefined
      },
      get skills(): never {
        throw new Error('cannot get property "skills" without inject')
      },
    }
    const agent = {
      id: 'agent-1',
      session: { header: { cwd: '/ws' } },
      ctx,
    }

    expect(getAgentService(agent as never, 'skills')).toBe(service)
  })

  it('fails clearly when the requested service is absent', () => {
    const agent = {
      id: 'agent-1',
      session: { header: { cwd: '/ws' } },
      ctx: { get: () => undefined },
    }

    expect(() => getAgentService(agent as never, 'skills')).toThrow(
      'skills service is unavailable for agent',
    )
  })
})
