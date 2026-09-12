// @vitest-environment node
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { getAgentService } from '../src/host/scoped-service'

class ProbeSkills extends Service {
  constructor(ctx: Context) {
    super(ctx, 'skills')
  }

  callerContext(): Context {
    return this.ctx
  }
}

describe('getAgentService', () => {
  it('resolves a sibling-fiber service through ctx.get and rebinds method calls to the Agent Context', async () => {
    const root = new Context()
    let providerCtx!: Context
    let service!: ProbeSkills

    const provider = root.plugin((ctx: Context) => {
      providerCtx = ctx
      service = new ProbeSkills(ctx)
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
      expect(service.callerContext()).toBe(providerCtx)

      const scoped = getAgentService<ProbeSkills>({
        id: 'agent-1',
        session: { header: { cwd: '/ws' } },
        ctx: agentCtx,
      }, 'skills')
      expect(scoped.callerContext()).toBe(agentCtx)
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
