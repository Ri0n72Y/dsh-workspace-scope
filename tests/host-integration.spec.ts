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

function makeEnv(opts: { configText?: string } = {}) {
  const state = {
    configText: opts.configText ?? WHITELIST_TEXT,
    serverTools: [...SERVER_TOOLS],
    written: [] as Array<{ target: string; content: string }>,
  }
  const restrictCalls: Array<{ agentId: string; deny: string[]; disposed: boolean }> = []
  const skillRegistrations: Array<{
    agentId: string
    skill: typeof SKILLS[number]
    disposed: boolean
  }> = []
  const listeners: Record<string, Listener[]> = {}
  let routeHandler: ((req: unknown, res: unknown) => Promise<void>) | null = null

  const signal = { throwIfAborted() {} }
  const agent = (id: string) => ({
    id,
    status: 'idle' as const,
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
    runMaintenance: async <T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> =>
      job(signal as never),
    whenIdle: async (): Promise<void> => {},
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
      if (name === 'agents') return { get: (id: string) => agent(id), list: () => [] }
      if (name === 'skills') {
        return {
          snapshot: async () => ({ skills: SKILLS, complete: true }),
          get: async (skillName: string) => SKILLS.find((skill) => skill.name === skillName),
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

  it('locks config at session start, restricts MCP before pre-step, and refreshes Skill shadows', async () => {
    const env = makeEnv()
    apply(env.ctx as never)

    const first = env.agent('a1')
    await dispatchEvent(env.listeners, 'agent/session-start', { agent: first })
    expect(env.restrictCalls).toEqual([
      { agentId: 'a1', deny: ['mcp__github__list'], disposed: false },
    ])
    expect(env.skillRegistrations).toHaveLength(0)

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
    await dispatchEvent(env.listeners, 'agent/session-start', { agent: second })
    expect(env.restrictCalls[1]!.deny).toEqual([
      'mcp__playwright__navigate',
      'mcp__playwright__click',
    ])
    await dispatchPreStep(env.listeners, payloadOf(second))
    expect(env.skillRegistrations[2]!.skill.name).toBe('keep-skill')
  })

  it('rebuilds only MCP restrictions when the Host-global tool inventory changes', async () => {
    const env = makeEnv()
    apply(env.ctx as never)
    const first = env.agent('a1')

    await dispatchEvent(env.listeners, 'agent/session-start', { agent: first })
    expect(env.restrictCalls).toHaveLength(1)

    env.state.serverTools.push('mcp__github__create')
    await dispatchEvent(env.listeners, 'tools/change')
    expect(env.restrictCalls).toHaveLength(2)
    expect(env.restrictCalls[0]!.disposed).toBe(true)
    expect(env.restrictCalls[1]!.deny).toEqual([
      'mcp__github__list',
      'mcp__github__create',
    ])

    await dispatchEvent(env.listeners, 'tools/change')
    expect(env.restrictCalls).toHaveLength(2)
    expect(env.skillRegistrations).toHaveLength(0)
  })
})
