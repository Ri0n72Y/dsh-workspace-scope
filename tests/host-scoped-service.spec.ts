// @vitest-environment node
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { getAgentService } from '../src/host/scoped-service'

describe('getAgentService', () => {
  it('resolves a sibling-fiber service through ctx.get while raw property access fails', async () => {
    const root = new Context()
    const service = { register() {} }

    const provider = root.plugin((providerCtx: Context) => {
      providerCtx.provide('skills', service)
    })
    await provider

    let agentCtx!: Context
    const loop = root.plugin(async (loopCtx: Context) => {
      const agent = loopCtx.plugin((ctx: Context) => {
        agentCtx = ctx
      })
      await agent
    })
    await loop

    try {
      expect(() => (agentCtx as unknown as { skills: unknown }).skills).toThrow(
        'cannot get property "skills" without inject',
      )
      expect(getAgentService({
        id: 'agent-1',
        session: { header: { cwd: '/ws' } },
        ctx: agentCtx,
      }, 'skills')).toBe(service)
    } finally {
      await loop.dispose()
      await provider.dispose()
    }
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
