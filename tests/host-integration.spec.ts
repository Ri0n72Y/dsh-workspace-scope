// @vitest-environment node
/**
 * Host behavior tests through the real apply(): the webServer routes
 * (overview/save/405/404), the MCP restriction applied per pre-step, and the
 * per-conversation config lock. Mocks cover only the boundaries: services,
 * fs, and the agent's tools.restrict.
 */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index'

const SERVERS = ['mcp__playwright__navigate', 'mcp__playwright__click', 'mcp__github__list']
const SKILLS = [
  { name: 'keep-skill', description: 'kept', invocation: { modelInvocable: true } },
  { name: 'hidden-skill', description: 'not model invocable', invocation: { modelInvocable: false } },
]

const WHITELIST_TEXT = JSON.stringify({
  default: { mode: 'whitelist', skills: ['keep-skill'], mcps: ['playwright'] },
})
const BLACKLIST_TEXT = JSON.stringify({
  default: { mode: 'blacklist', skills: [], mcps: ['playwright'] },
})

function makeEnv(opts: { configText?: string } = {}) {
  const state = {
    configText: opts.configText ?? WHITELIST_TEXT,
    written: [] as Array<{ target: string; content: string }>,
  }
  const restrictCalls: Array<{ deny: string[] }> = []
  const agentCtx = {
    tools: {
      restrict: (filter: { deny: string[] }): (() => void) => {
        restrictCalls.push({ deny: [...filter.deny] })
        return () => {}
      },
    },
  }
  const listeners: Array<{ fn: (...args: never[]) => unknown; prepend?: boolean }> = []
  const preExecutes: Array<{ fn: (...args: never[]) => unknown }> = []
  let routeHandler: ((req: unknown, res: unknown) => Promise<void>) | null = null
  const webServer = {
    register: (route: { handler: (req: unknown, res: unknown) => Promise<void> }): (() => void) => {
      routeHandler = route.handler
      return () => { routeHandler = null }
    },
  }
  const ctx = {
    get: (name: string): unknown => {
      if (name === 'webServer') return webServer
      if (name === 'agents') {
        return { get: (id: string) => ({ id, session: { header: { cwd: '/ws' } } }) }
      }
      if (name === 'skills') {
        return { snapshot: async () => ({ skills: SKILLS, complete: true }), get: async () => undefined }
      }
      if (name === 'tools') return { schemas: () => SERVERS.map((n) => ({ name: n })) }
      if (name === 'fs') {
        return {
          resolve: async (p: string): Promise<string> => p,
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
    on: (name: string, fn: (...args: never[]) => unknown, options?: boolean | { prepend?: boolean }): (() => boolean) => {
      if (name === 'tools/pre-execute') {
        preExecutes.push({ fn })
        return () => true
      }
      if (name !== 'agent/pre-step') return () => true
      const prepend = options === true || (options !== undefined && typeof options === 'object' && options.prepend === true)
      if (prepend) listeners.unshift({ fn, prepend })
      else listeners.push({ fn })
      return () => true
    },
  }
  return { ctx, listeners, preExecutes, state, restrictCalls, agentCtx, routeHandler: () => routeHandler }
}

async function dispatchPreStep(listeners: Array<{ fn: (...args: never[]) => unknown }>, payload: Record<string, unknown>): Promise<unknown> {
  const cbs = listeners.map((l) => l.fn)
  const inner = async (): Promise<unknown> => ({ kind: 'enter', messages: payload.messages })
  const next = (): unknown => {
    const cb = cbs.shift() ?? inner
    return (cb as (...args: unknown[]) => unknown)(payload, next)
  }
  return next()
}

function payloadOf(agentId: string, tools: unknown): Record<string, unknown> {
  return {
    agent: { id: agentId, session: { header: { cwd: '/ws' } }, ctx: { tools } },
    messages: [],
    signal: { throwIfAborted: () => {} },
  }
}

function makeRes(): {
  statusCode: number
  headers: Record<string, string>
  body: string
  setHeader: (k: string, v: string) => void
  end: (body: string) => void
} {
  const res: {
    statusCode: number
    headers: Record<string, string>
    body: string
    setHeader: (k: string, v: string) => void
    end: (body: string) => void
  } = {
    statusCode: 0,
    headers: {},
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
    // model-invocable filter applies; hidden-skill is dropped
    expect(body.skills.map((s) => s.name)).toEqual(['keep-skill'])
    // tools grouped per server, sorted by server name
    expect(body.mcp).toEqual([
      { server: 'github', toolCount: 1 },
      { server: 'playwright', toolCount: 2 },
    ])
    expect(body.config.mode).toBe('whitelist')
    expect(body.config.skills).toEqual(['keep-skill'])
    expect(body.config.mcps).toEqual(['playwright'])
  })

  it('saves the posted config through fs and rejects wrong methods/paths', async () => {
    const env = makeEnv()
    apply(env.ctx as never)
    const handler = env.routeHandler()!

    const res = makeRes()
    const body = JSON.stringify({ sessionId: 's1', mode: 'whitelist', skills: ['keep-skill'], mcps: ['playwright'] })
    await handler(makeReqPost('/api/dsh-workspace-scope/save', body) as never, res as never)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).saved).toBe(true)
    expect(env.state.written).toHaveLength(1)
    const written = JSON.parse(env.state.written[0]!.content) as { default: { mode: string; mcps: string[] } }
    expect(written.default.mode).toBe('whitelist')
    expect(written.default.mcps).toEqual(['playwright'])

    const bad1 = makeRes()
    await handler(makeReqGet('/api/dsh-workspace-scope/save') as never, bad1 as never)
    expect(bad1.statusCode).toBe(405)

    const bad2 = makeRes()
    await handler(makeReqGet('/api/dsh-workspace-scope/nope') as never, bad2 as never)
    expect(bad2.statusCode).toBe(404)
  })

  it('restricts MCP tools per pre-step and locks the config per conversation', async () => {
    const env = makeEnv()
    apply(env.ctx as never)
    const listeners = env.listeners

    // First step: whitelist keeps playwright, so github's tool is denied.
    await dispatchPreStep(listeners, payloadOf('a1', env.agentCtx.tools))
    expect(env.restrictCalls).toHaveLength(1)
    expect(env.restrictCalls[0]!.deny).toEqual(['mcp__github__list'])

    // Second step of the same conversation: config is locked, restriction is
    // identical, so restrict() is not called again (same-deny skip).
    env.state.configText = BLACKLIST_TEXT
    await dispatchPreStep(listeners, payloadOf('a1', env.agentCtx.tools))
    expect(env.restrictCalls).toHaveLength(1)

    // A new conversation reads the new config: blacklist excludes playwright.
    await dispatchPreStep(listeners, payloadOf('a2', env.agentCtx.tools))
    expect(env.restrictCalls).toHaveLength(2)
    expect(env.restrictCalls[1]!.deny).toEqual(['mcp__playwright__navigate', 'mcp__playwright__click'])
  })

  it('denies the skill tool for excluded skills via tools/pre-execute', async () => {
    const env = makeEnv()
    apply(env.ctx as never)
    // prime lastConfigs through a pre-step (the guard reads the cache)
    await dispatchPreStep(env.listeners, payloadOf('a1', env.agentCtx.tools))

    const guard = env.preExecutes[0]!.fn
    const next = (): unknown => ({ kind: 'enter' })
    const exec = {
      name: 'skill',
      agent: { id: 'a1' },
      arguments: { name: 'keep-skill' },
    }
    // whitelist keeps keep-skill: passes through
    expect(guard(exec, next)).toEqual(next())
    // hidden-skill is not in the whitelist: denied
    const denied = guard({ ...exec, arguments: { name: 'hidden-skill' } }, next) as { kind: string; reason: string }
    expect(denied.kind).toBe('deny')
    expect(denied.reason).toContain('excluded by the workspace scope config')
  })
})
