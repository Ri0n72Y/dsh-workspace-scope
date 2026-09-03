// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index'

const SERVER_TOOLS = [
  'mcp__playwright__navigate',
  'mcp__playwright__click',
  'mcp__github__list',
]
const SKILLS = [
  {
    name: 'keep-skill',
    description: 'kept',
    content: 'keep body',
    source: 'custom',
    provider: 'test',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    name: 'drop-skill',
    description: 'dropped by workspace policy',
    content: 'drop body',
    source: 'custom',
    provider: 'test',
    invocation: { modelInvocable: true, userInvocable: true },
  },
  {
    name: 'hidden-skill',
    description: 'already hidden',
    content: 'hidden body',
    source: 'custom',
    provider: 'test',
    invocation: { modelInvocable: false, userInvocable: true },
  },
]

const WHITELIST_TEXT = JSON.stringify({
  default: { mode: 'whitelist', skills: ['keep-skill'], mcps: ['playwright'] },
})
const BLACKLIST_TEXT = JSON.stringify({
  default: { mode: 'blacklist', skills: ['keep-skill'], mcps: ['playwright'] },
})

type Listener = (...args: never[]) => unknown

type TestAgent = ReturnType<ReturnType<typeof makeEnv>['agent']>

function makeEnv(opts: { configText?: string; blockedSkillRegistrations?: string[] } = {}) {
  const blockedSkillRegistrations = new Set(opts.blockedSkillRegistrations ?? [])
  const state = {
    configText: opts.configText ?? WHITELIST_TEXT,
    serverTools: [...SERVER_TOOLS],
    written: [] as Array<{ target: string; content: string }>,
    assemblyCalls: 0,
    assemblyTerminalCalls: 0,
  }
  const restrictCalls: Array<{ agentId: string; deny: string[]; disposed: boolean }> = []
  const skillRegistrations: Array<{
    agentId: string
    skill: typeof SKILLS[number]
    disposed: boolean
  }> = []
  const listeners: Record<string, Listener[]> = {}
  const agentMap = new Map<string, ReturnType<typeof createAgent>>()
  let routeHandler: ((req: unknown, res: unknown) => Promise<void>) | null = null

  const signal = { throwIfAborted() {} }

  function createAgent(id: string) {
    return {
      id,
      session: { header: { cwd: '/ws' } },
      ctx: {
        tools: {
          restrict: (filter: { deny: string[] }): (() => void) => {
            const call = { agentId: id, deny: [...filter.deny], disposed: false }
            restrictCalls.push(call)
            return () => { call.disposed = true }
          },
        },
        skills: {
          register: (skill: typeof SKILLS[number]): (() => void) => {
            if (blockedSkillRegistrations.has(skill.name)) return () => {}
            const call = { agentId: id, skill, disposed: false }
            skillRegistrations.push(call)
            return () => { call.disposed = true }
          },
        },
      },
    }
  }

  const agent = (id: string) => {
    let found = agentMap.get(id)
    if (found === undefined) {
      found = createAgent(id)
      agentMap.set(id, found)
    }
    return found
  }

  function visibleSkills(scope: { id?: string } | undefined) {
    return SKILLS.map((skill) => {
      if (scope?.id === undefined) return skill
      return [...skillRegistrations].reverse().find((entry) =>
        entry.agentId === scope.id && !entry.disposed && entry.skill.name === skill.name,
      )?.skill ?? skill
    })
  }

  function visibleTools(agentId: string | undefined): string[] {
    if (agentId === undefined) return [...state.serverTools]
    const denied = new Set(
      restrictCalls
        .filter((call) => call.agentId === agentId && !call.disposed)
        .flatMap((call) => call.deny),
    )
    return state.serverTools.filter((name) => !denied.has(name))
  }

  async function dispatchWaterfall<T>(
    name: string,
    args: unknown[],
    terminal: () => Promise<T> | T,
  ): Promise<T> {
    const cbs = [...(listeners[name] ?? [])]
    const next = (): Promise<T> => {
      const cb = cbs.shift()
      return cb === undefined
        ? Promise.resolve(terminal())
        : Promise.resolve((cb as (...values: unknown[]) => T | Promise<T>)(...args, next))
    }
    return next()
  }

  const systemPrompt = {
    assemble: async (context: { agent?: TestAgent; signal?: unknown } = {}) => {
      state.assemblyCalls += 1
      const assembly = { tools: visibleTools(context.agent?.id).map((name) => ({ name })) }
      return dispatchWaterfall('system-prompt/assemble', [assembly, context], () => {
        state.assemblyTerminalCalls += 1
        return assembly
      })
    },
  }

  const webServer = {
    register: (route: { handler: (req: unknown, res: unknown) => Promise<void> }): (() => void) => {
      routeHandler = route.handler
      return () => { routeHandler = null }
    },
  }

  const ctx = {
    get: (name: string): unknown => {
      if (name === 'webServer') return webServer
      if (name === 'agents') return { get: (id: string) => agent(id) }
      if (name === 'systemPrompt') return systemPrompt
      if (name === 'skills') {
        return {
          snapshot: async (options: { scope?: { id?: string } } = {}) => ({
            skills: visibleSkills(options.scope),
            complete: true,
          }),
          get: async (skillName: string, options: { scope?: { id?: string } } = {}) =>
            visibleSkills(options.scope).find((skill) => skill.name === skillName),
        }
      }
      if (name === 'tools') {
        return { schemas: () => state.serverTools.map((toolName) => ({ name: toolName })) }
      }
      if (name === 'fs') {
        return {
          resolve: async (path: string): Promise<string> => path,
          readText: async (): Promise<string> => state.configText,
          writeText: async (target: unknown, content: string): Promise<void> => {
            state.written.push({ target: String(target), content })
          },
        }
      }
      if (name === 'sandboxPolicy') return { resolve: () => ({}) }
      return undefined
    },
    effect: (cb: () => void): (() => void) => { cb(); return () => {} },
    on: (name: string, fn: Listener): (() => boolean) => {
      ;(listeners[name] ??= []).push(fn)
      return () => true
    },
    logger: { warn() {} },
  }

  return {
    ctx,
    agent,
    listeners,
    state,
    signal,
    systemPrompt,
    restrictCalls,
    skillRegistrations,
    routeHandler: () => routeHandler,
  }
}

async function dispatchEvent(
  listeners: Record<string, Listener[]>,
  name: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await Promise.all((listeners[name] ?? []).map((fn) =>
    Promise.resolve((fn as (...args: unknown[]) => unknown)(payload))))
}

async function dispatchPreStep(
  listeners: Record<string, Listener[]>,
  payload: Record<string, unknown>,
  terminal: { kind: string } = { kind: 'enter' },
): Promise<unknown> {
  const cbs = [...(listeners['agent/pre-step'] ?? [])]
  const next = (): unknown => {
    const cb = cbs.shift()
    return cb === undefined ? terminal : (cb as (...args: unknown[]) => unknown)(payload, next)
  }
  return next()
}

function payloadOf(agent: TestAgent): Record<string, unknown> {
  return {
    agent,
    messages: [],
    signal: { throwIfAborted: () => {} },
  }
}

function makeRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: string) { res.headers[k] = v },
    end(body: string) { res.body = body },
  }
  return res
}

function makeReqGet(url: string): Record<string, unknown> {
  return { method: 'GET', url, setEncoding() {}, on() {}, destroy() {} }
}

function makeReqPost(url: string, body: string): Record<string, unknown> {
  const req: Record<string, unknown> = { method: 'POST', url, setEncoding() {}, destroy() {}, _body: body }
  req.on = (ev: string, cb: (chunk?: string) => void): void => {
    if (ev === 'data') process.nextTick(() => cb(req._body as string))
    if (ev === 'end') process.nextTick(() => cb())
  }
  return req
}

describe('workspace-scope host behavior', () => {
  it('serves overview from the skills snapshot, tools and config', async () => {
    const env = makeEnv()
    apply(env.ctx as never)
    const handler = env.routeHandler()
    expect(handler).not.toBeNull()

    const res = makeRes()
    await handler!(makeReqGet('/api/dsh-workspace-scope/overview?sessionId=s1') as never, res as never)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as {
      skills: Array<{ name: string }>
      mcp: Array<{ server: string; toolCount: number }>
      config: { mode: string; skills: string[]; mcps: string[] }
    }
    expect(body.skills.map((skill) => skill.name)).toEqual([
      'keep-skill',
      'drop-skill',
      'hidden-skill',
    ])
    expect(body.mcp).toEqual([
      { server: 'github', toolCount: 1 },
      { server: 'playwright', toolCount: 2 },
    ])
    expect(body.config).toEqual({
      mode: 'whitelist',
      skills: ['keep-skill'],
      mcps: ['playwright'],
    })
  })

  it('saves config and keeps route errors bounded', async () => {
    const env = makeEnv()
    apply(env.ctx as never)
    const handler = env.routeHandler()!

    const res = makeRes()
    await handler(
      makeReqPost(
        '/api/dsh-workspace-scope/save',
        JSON.stringify({ sessionId: 's1', mode: 'whitelist', skills: ['keep-skill'], mcps: ['playwright'] }),
      ) as never,
      res as never,
    )
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).saved).toBe(true)
    expect(env.state.written).toHaveLength(1)

    const badMethod = makeRes()
    await handler(makeReqGet('/api/dsh-workspace-scope/save') as never, badMethod as never)
    expect(badMethod.statusCode).toBe(405)

    const missing = makeRes()
    await handler(makeReqGet('/api/dsh-workspace-scope/nope') as never, missing as never)
    expect(missing.statusCode).toBe(404)
  })

  it('locks config on the first turn assembly and keeps Skill shadows across steps', async () => {
    const env = makeEnv()
    apply(env.ctx as never)
    const first = env.agent('a1')

    // Agent-scoped diagnostics have no turn signal and must not lock the blank session.
    await env.systemPrompt.assemble({ agent: first })
    expect(env.restrictCalls).toHaveLength(0)

    const assembly = await env.systemPrompt.assemble({ agent: first, signal: env.signal })
    expect(assembly.tools.map((tool) => tool.name)).toEqual([
      'mcp__playwright__navigate',
      'mcp__playwright__click',
    ])
    expect(env.restrictCalls).toEqual([
      { agentId: 'a1', deny: ['mcp__github__list'], disposed: false },
    ])
    // The outer pre-policy assembly is discarded; downstream sees only the rebuild.
    expect(env.state.assemblyTerminalCalls).toBe(2)

    await dispatchPreStep(env.listeners, payloadOf(first))
    expect(env.skillRegistrations).toHaveLength(1)
    expect(env.skillRegistrations[0]!.skill.name).toBe('drop-skill')
    expect(env.skillRegistrations[0]!.skill.invocation).toEqual({
      modelInvocable: false,
      userInvocable: true,
    })

    env.state.configText = BLACKLIST_TEXT
    await dispatchPreStep(env.listeners, payloadOf(first))
    expect(env.skillRegistrations).toHaveLength(2)
    expect(env.skillRegistrations[0]!.disposed).toBe(true)
    expect(env.skillRegistrations[1]!.skill.name).toBe('drop-skill')
    expect(env.restrictCalls).toHaveLength(1)

    const second = env.agent('a2')
    await env.systemPrompt.assemble({ agent: second, signal: env.signal })
    expect(env.restrictCalls[1]!.deny).toEqual([
      'mcp__playwright__click',
      'mcp__playwright__navigate',
    ])
    await dispatchPreStep(env.listeners, payloadOf(second))
    expect(env.skillRegistrations[2]!.skill.name).toBe('keep-skill')
  })

  it('fails closed when a same-layer runtime Skill prevents the deny shadow from winning', async () => {
    const env = makeEnv({ blockedSkillRegistrations: ['drop-skill'] })
    apply(env.ctx as never)
    const agent = env.agent('a1')

    await env.systemPrompt.assemble({ agent, signal: env.signal })
    await expect(dispatchPreStep(env.listeners, payloadOf(agent)))
      .rejects.toThrow('failed to hide skill "drop-skill"')
  })

  it('reassembles only when the effective denied MCP set changes', async () => {
    const env = makeEnv()
    apply(env.ctx as never)
    const first = env.agent('a1')

    await env.systemPrompt.assemble({ agent: first, signal: env.signal })
    expect(env.restrictCalls).toHaveLength(1)

    env.state.serverTools.push('mcp__github__create')
    const changed = await env.systemPrompt.assemble({ agent: first, signal: env.signal })
    expect(changed.tools.map((tool) => tool.name)).toEqual([
      'mcp__playwright__navigate',
      'mcp__playwright__click',
    ])
    expect(env.restrictCalls).toHaveLength(2)
    expect(env.restrictCalls[0]!.disposed).toBe(true)
    expect(env.restrictCalls[1]!.deny).toEqual([
      'mcp__github__create',
      'mcp__github__list',
    ])

    await env.systemPrompt.assemble({ agent: first, signal: env.signal })
    expect(env.restrictCalls).toHaveLength(2)
    expect(env.skillRegistrations).toHaveLength(0)
  })
})
