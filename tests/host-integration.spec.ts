// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index'

const SERVERS = ['mcp__playwright__navigate', 'mcp__playwright__click', 'mcp__github__list']
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

function makeEnv(opts: { configText?: string } = {}) {
  const state = {
    configText: opts.configText ?? WHITELIST_TEXT,
    written: [] as Array<{ target: string; content: string }>,
  }
  const restrictCalls: Array<{ agentId: string; deny: string[]; disposed: boolean }> = []
  const skillRegistrations: Array<{
    agentId: string
    skill: typeof SKILLS[number]
    disposed: boolean
  }> = []
  const listeners: Array<{ fn: (...args: never[]) => unknown }> = []
  let routeHandler: ((req: unknown, res: unknown) => Promise<void>) | null = null

  const agent = (id: string) => ({
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
          const call = { agentId: id, skill, disposed: false }
          skillRegistrations.push(call)
          return () => { call.disposed = true }
        },
      },
    },
  })

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
      if (name === 'skills') {
        return {
          snapshot: async () => ({ skills: SKILLS, complete: true }),
          get: async (skillName: string) => SKILLS.find((skill) => skill.name === skillName),
        }
      }
      if (name === 'tools') return { schemas: () => SERVERS.map((toolName) => ({ name: toolName })) }
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
    on: (name: string, fn: (...args: never[]) => unknown): (() => boolean) => {
      if (name === 'agent/pre-step') listeners.push({ fn })
      return () => true
    },
  }

  return {
    ctx,
    agent,
    listeners,
    state,
    restrictCalls,
    skillRegistrations,
    routeHandler: () => routeHandler,
  }
}

async function dispatchPreStep(
  listeners: Array<{ fn: (...args: never[]) => unknown }>,
  payload: Record<string, unknown>,
  terminal: { kind: string } = { kind: 'enter' },
): Promise<unknown> {
  const cbs = listeners.map((listener) => listener.fn)
  const next = (): unknown => {
    const cb = cbs.shift()
    return cb === undefined ? terminal : (cb as (...args: unknown[]) => unknown)(payload, next)
  }
  return next()
}

function payloadOf(agent: ReturnType<ReturnType<typeof makeEnv>['agent']>): Record<string, unknown> {
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
    expect(body.skills.map((skill) => skill.name)).toEqual(['keep-skill', 'drop-skill'])
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

  it('uses native scoped Skill shadows and MCP restrict, locked per conversation', async () => {
    const env = makeEnv()
    apply(env.ctx as never)

    const first = env.agent('a1')
    await dispatchPreStep(env.listeners, payloadOf(first))

    expect(env.skillRegistrations).toHaveLength(1)
    expect(env.skillRegistrations[0]!.agentId).toBe('a1')
    expect(env.skillRegistrations[0]!.skill.name).toBe('drop-skill')
    expect(env.skillRegistrations[0]!.skill.invocation).toEqual({
      modelInvocable: false,
      userInvocable: true,
    })
    expect(env.restrictCalls).toEqual([
      { agentId: 'a1', deny: ['mcp__github__list'], disposed: false },
    ])

    env.state.configText = BLACKLIST_TEXT
    await dispatchPreStep(env.listeners, payloadOf(first))
    expect(env.skillRegistrations).toHaveLength(1)
    expect(env.restrictCalls).toHaveLength(1)

    const second = env.agent('a2')
    await dispatchPreStep(env.listeners, payloadOf(second))
    expect(env.skillRegistrations).toHaveLength(2)
    expect(env.skillRegistrations[1]!.skill.name).toBe('keep-skill')
    expect(env.restrictCalls[1]!.deny).toEqual([
      'mcp__playwright__navigate',
      'mcp__playwright__click',
    ])
  })

  it('rolls back a provisional scope when the first pre-step is rejected', async () => {
    const env = makeEnv()
    apply(env.ctx as never)
    const first = env.agent('a1')

    const rejected = await dispatchPreStep(env.listeners, payloadOf(first), { kind: 'reject' })
    expect(rejected).toEqual({ kind: 'reject' })
    expect(env.skillRegistrations[0]!.disposed).toBe(true)
    expect(env.restrictCalls[0]!.disposed).toBe(true)

    env.state.configText = BLACKLIST_TEXT
    await dispatchPreStep(env.listeners, payloadOf(first))
    expect(env.skillRegistrations).toHaveLength(2)
    expect(env.skillRegistrations[1]!.skill.name).toBe('keep-skill')
  })
})
