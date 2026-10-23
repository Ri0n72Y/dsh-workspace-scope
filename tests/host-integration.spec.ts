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
const LATE_SKILL = {
  name: 'late-skill',
  description: 'appeared during policy installation',
  content: 'late body',
  source: 'custom',
  provider: 'test',
  invocation: { modelInvocable: true, userInvocable: true },
}

const WHITELIST_TEXT = JSON.stringify({
  default: { mode: 'whitelist', skills: ['keep-skill'], mcps: ['playwright'] },
})
const BLACKLIST_TEXT = JSON.stringify({
  default: { mode: 'blacklist', skills: ['keep-skill'], mcps: ['playwright'] },
})
const AUDIO_TEXT = JSON.stringify({
  default: { mode: 'whitelist', skills: ['drop-skill'], mcps: ['github'] },
})
const ROOT_FILE = '/ws/.dsh-scope.json'
const AUDIO_DIR = '/ws/scenarios/audio'
const AUDIO_FILE = `${AUDIO_DIR}/.dsh-scope.json`

type Listener = (...args: never[]) => unknown

type TestAgent = ReturnType<ReturnType<typeof makeEnv>['agent']>

function makeEnv(opts: {
  configText?: string
  blockedSkillRegistrations?: string[]
  incompleteSkillSnapshots?: string[]
  missingAgents?: string[]
  missingSkillTools?: string[]
  lateSkillOnSecondSnapshot?: boolean
  revisionSensitiveSkillSnapshots?: boolean
  writeGate?: Promise<void>
  /** Scope files besides the workspace root file, by absolute path. */
  files?: Record<string, string>
  /** Effective working directory per Agent id; enables the workingDirectory service. */
  workingDirectory?: Record<string, string>
  /** Symbolic links by absolute path, mapped to their target path. */
  symlinks?: Record<string, string>
} = {}) {
  const blockedSkillRegistrations = new Set(opts.blockedSkillRegistrations ?? [])
  const incompleteSkillSnapshots = new Set(opts.incompleteSkillSnapshots ?? [])
  const missingAgents = new Set(opts.missingAgents ?? [])
  const missingSkillTools = new Set(opts.missingSkillTools ?? [])
  const state = {
    // An explicit `configText: undefined` models a workspace without a root scope file.
    configText: 'configText' in opts ? opts.configText : WHITELIST_TEXT,
    serverTools: [...SERVER_TOOLS],
    written: [] as Array<{ target: string; content: string }>,
    files: new Map(Object.entries(opts.files ?? {})),
    assemblyCalls: 0,
    assemblyTerminalCalls: 0,
  }
  const restrictCalls: Array<{ agentId: string; deny: string[]; disposed: boolean }> = []
  const skillRegistrations: Array<{
    agentId: string
    skill: typeof SKILLS[number]
    disposed: boolean
  }> = []
  const skillSnapshotCalls = new Map<string, number>()
  const skillSnapshotCwds: Array<{ agentId: string; cwd: unknown }> = []
  const effectiveCwds = new WeakMap<object, string>()
  const fileText = (path: string): string | undefined =>
    path === ROOT_FILE ? state.configText : state.files.get(path)
  let skillRevision = 0
  const listeners: Record<string, Listener[]> = {}
  const agentMap = new Map<string, ReturnType<typeof createAgent>>()
  let routeHandler: ((req: unknown, res: unknown) => Promise<void>) | null = null

  const signal = { throwIfAborted() {} }

  function createAgent(id: string) {
    const scopedTools = {
      restrict: (filter: { deny: string[] }): (() => void) => {
        const call = { agentId: id, deny: [...filter.deny], disposed: false }
        restrictCalls.push(call)
        return () => { call.disposed = true }
      },
    }
    const scopedSkills = {
      register: (skill: typeof SKILLS[number]): (() => void) => {
        if (blockedSkillRegistrations.has(skill.name)) return () => {}
        const call = { agentId: id, skill, disposed: false }
        skillRegistrations.push(call)
        skillRevision += 1
        return () => {
          if (call.disposed) return
          call.disposed = true
          skillRevision += 1
        }
      },
    }
    const session = { header: { cwd: '/ws' } }
    const effective = opts.workingDirectory?.[id]
    if (effective !== undefined) effectiveCwds.set(session, effective)
    return {
      id,
      session,
      ctx: {
        // Match the Cordis Context seam used by production. Keeping the named
        // faces also makes this fixture useful for assertions on scoped effects.
        get: (name: string): unknown => {
          if (name === 'tools') return scopedTools
          if (name === 'skills') return scopedSkills
          return undefined
        },
        tools: scopedTools,
        skills: scopedSkills,
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

  function visibleSkills(scope: { id?: string } | undefined, includeLate = false) {
    const source = includeLate ? [...SKILLS, LATE_SKILL] : SKILLS
    return source.map((skill) => {
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
      if (name === 'agents') {
        return { get: (id: string) => missingAgents.has(id) ? undefined : agent(id) }
      }
      if (name === 'systemPrompt') return systemPrompt
      if (name === 'skills') {
        return {
          snapshot: async (options: { scope?: { id?: string }; cwd?: unknown } = {}) => {
            const id = options.scope?.id
            if (id !== undefined) skillSnapshotCwds.push({ agentId: id, cwd: options.cwd })
            const calls = id === undefined ? 0 : (skillSnapshotCalls.get(id) ?? 0)
            if (id !== undefined) skillSnapshotCalls.set(id, calls + 1)
            const revision = skillRevision
            if (opts.revisionSensitiveSkillSnapshots === true) {
              await new Promise<void>((resolve) => setTimeout(resolve, 0))
            }
            return {
              skills: visibleSkills(
                options.scope,
                opts.lateSkillOnSecondSnapshot === true && calls > 0,
              ),
              complete: (id === undefined || !incompleteSkillSnapshots.has(id))
                && (opts.revisionSensitiveSkillSnapshots !== true || revision === skillRevision),
            }
          },
          get: async (skillName: string, options: { scope?: { id?: string } } = {}) =>
            visibleSkills(options.scope).find((skill) => skill.name === skillName),
        }
      }
      if (name === 'tools') {
        return {
          get: (toolName: string, scope?: { id?: string }) =>
            toolName === 'skill'
            && scope?.id !== undefined
            && !missingSkillTools.has(scope.id)
              ? { name: 'skill' }
              : undefined,
          schemas: () => state.serverTools.map((toolName) => ({ name: toolName })),
        }
      }
      if (name === 'fs') {
        return {
          resolve: async (path: string): Promise<string> => opts.symlinks?.[path] ?? path,
          processPath: (target: unknown): string => String(target),
          contains: (parent: unknown, child: unknown): boolean =>
            child === parent || String(child).startsWith(`${String(parent)}/`),
          lstat: async (path: string) => {
            if (opts.symlinks?.[path] !== undefined) return { type: 'symlink' }
            return fileText(path) === undefined ? undefined : { type: 'file' }
          },
          readText: async (target: unknown): Promise<string> => {
            const text = fileText(String(target))
            if (text === undefined) throw new Error('FS_NOT_FOUND')
            return text
          },
          writeText: async (target: unknown, content: string): Promise<void> => {
            state.written.push({ target: String(target), content })
            await opts.writeGate
            if (String(target) === ROOT_FILE) state.configText = content
            else state.files.set(String(target), content)
          },
        }
      }
      if (name === 'workingDirectory' && opts.workingDirectory !== undefined) {
        return {
          get: (session: { header: { cwd: string } }): string =>
            effectiveCwds.get(session) ?? session.header.cwd,
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
    skillSnapshotCwds,
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
  it('serves overview from the model-invocable live Agent Skill snapshot, tools and config', async () => {
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

  it('groups MCP raw names containing double underscores under the first delimiter', async () => {
    const env = makeEnv()
    env.state.serverTools.push('mcp__github__issue__list')
    apply(env.ctx as never)
    const handler = env.routeHandler()!

    const res = makeRes()
    await handler(
      makeReqGet('/api/dsh-workspace-scope/overview?sessionId=s1') as never,
      res as never,
    )
    const body = JSON.parse(res.body) as { mcp: Array<{ server: string; toolCount: number }> }
    expect(body.mcp).toEqual([
      { server: 'github', toolCount: 2 },
      { server: 'playwright', toolCount: 2 },
    ])
  })

  it('does not expose Skills when the current Agent has no model Skill tool surface', async () => {
    const env = makeEnv({ missingSkillTools: ['s1'] })
    apply(env.ctx as never)
    const handler = env.routeHandler()!

    const res = makeRes()
    await handler(
      makeReqGet('/api/dsh-workspace-scope/overview?sessionId=s1') as never,
      res as never,
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { skills: unknown[] }
    expect(body.skills).toEqual([])
  })

  it('rejects an incomplete Agent Skill snapshot instead of exposing partial inventory', async () => {
    const env = makeEnv({ incompleteSkillSnapshots: ['s1'] })
    apply(env.ctx as never)
    const handler = env.routeHandler()!

    const res = makeRes()
    await handler(
      makeReqGet('/api/dsh-workspace-scope/overview?sessionId=s1') as never,
      res as never,
    )
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).error).toContain('skill catalog is incomplete')
  })

  it('does not substitute the Host-global Skill view when the requested Agent is absent', async () => {
    const env = makeEnv({ missingAgents: ['missing'] })
    apply(env.ctx as never)
    const handler = env.routeHandler()!

    const res = makeRes()
    await handler(
      makeReqGet('/api/dsh-workspace-scope/overview?sessionId=missing') as never,
      res as never,
    )
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { skills: unknown[]; mcp: unknown[] }
    expect(body.skills).toEqual([])
    expect(body.mcp).toHaveLength(2)
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

  it('waits for a pending autosave before the first policy lock', async () => {
    let releaseWrite!: () => void
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const env = makeEnv({ writeGate })
    apply(env.ctx as never)
    const handler = env.routeHandler()!

    const saveRes = makeRes()
    const save = handler(
      makeReqPost(
        '/api/dsh-workspace-scope/save',
        JSON.stringify({ sessionId: 'a1', mode: 'blacklist', skills: ['keep-skill'], mcps: ['playwright'] }),
      ) as never,
      saveRes as never,
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(env.state.written).toHaveLength(1)

    const assembly = env.systemPrompt.assemble({ agent: env.agent('a1'), signal: env.signal })
    const race = await Promise.race([
      assembly.then(() => 'assembled'),
      new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 0)),
    ])
    expect(race).toBe('pending')

    releaseWrite()
    await save
    expect((await assembly).tools.map((tool) => tool.name)).toEqual(['mcp__github__list'])
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

  it('serializes concurrent Skill policy refreshes and overview reads across Agents', async () => {
    const env = makeEnv({
      configText: BLACKLIST_TEXT,
      revisionSensitiveSkillSnapshots: true,
    })
    apply(env.ctx as never)
    const agents = ['a1', 'a2', 'a3', 'a4'].map((id) => env.agent(id))
    await Promise.all(agents.map((agent) =>
      env.systemPrompt.assemble({ agent, signal: env.signal })))

    const handler = env.routeHandler()!
    const res = makeRes()
    await expect(Promise.all([
      ...agents.map((agent) => dispatchPreStep(env.listeners, payloadOf(agent))),
      handler(
        makeReqGet('/api/dsh-workspace-scope/overview?sessionId=a1') as never,
        res as never,
      ),
    ])).resolves.toBeDefined()

    expect(res.statusCode).toBe(200)
    expect(env.skillRegistrations.filter((entry) => !entry.disposed)).toHaveLength(4)
  })

  it('skips Skill policy when the Agent has no model Skill tool surface', async () => {
    const env = makeEnv({
      missingSkillTools: ['a1'],
      incompleteSkillSnapshots: ['a1'],
    })
    apply(env.ctx as never)
    const agent = env.agent('a1')

    await env.systemPrompt.assemble({ agent, signal: env.signal })
    await expect(dispatchPreStep(env.listeners, payloadOf(agent)))
      .resolves.toEqual({ kind: 'enter' })
    expect(env.skillRegistrations).toHaveLength(0)
  })

  it('fails closed when a same-layer runtime Skill prevents the deny shadow from winning', async () => {
    const env = makeEnv({ blockedSkillRegistrations: ['drop-skill'] })
    apply(env.ctx as never)
    const agent = env.agent('a1')

    await env.systemPrompt.assemble({ agent, signal: env.signal })
    await expect(dispatchPreStep(env.listeners, payloadOf(agent)))
      .rejects.toThrow('failed to hide skill "drop-skill"')
  })

  it('fails closed when the verified snapshot adds a newly denied Skill', async () => {
    const env = makeEnv({ lateSkillOnSecondSnapshot: true })
    apply(env.ctx as never)
    const agent = env.agent('a1')

    await env.systemPrompt.assemble({ agent, signal: env.signal })
    await expect(dispatchPreStep(env.listeners, payloadOf(agent)))
      .rejects.toThrow('failed to hide skill "late-skill"')
    expect(env.skillRegistrations[0]!.disposed).toBe(true)
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

describe('scope of a subagent started in another folder', () => {
  // DSH copies the parent's header cwd into a subagent Session and commits the
  // requested cwd to the workingDirectory projection before the first request.
  const subagentEnv = (extra: Parameters<typeof makeEnv>[0] = {}) => makeEnv({
    files: { [AUDIO_FILE]: AUDIO_TEXT },
    workingDirectory: { sub: AUDIO_DIR },
    ...extra,
  })

  it('locks the scope file of the effective working directory', async () => {
    const env = subagentEnv()
    apply(env.ctx as never)

    await env.systemPrompt.assemble({ agent: env.agent('sub'), signal: env.signal })
    expect(env.restrictCalls[0]).toEqual({
      agentId: 'sub',
      deny: ['mcp__playwright__click', 'mcp__playwright__navigate'],
      disposed: false,
    })

    // A Session whose effective cwd is the header cwd keeps the root file.
    await env.systemPrompt.assemble({ agent: env.agent('root'), signal: env.signal })
    expect(env.restrictCalls[1]!.deny).toEqual(['mcp__github__list'])
  })

  it('builds and verifies Skill shadows on the effective working directory', async () => {
    const env = subagentEnv()
    apply(env.ctx as never)
    const sub = env.agent('sub')

    await env.systemPrompt.assemble({ agent: sub, signal: env.signal })
    await dispatchPreStep(env.listeners, payloadOf(sub))
    expect(env.skillRegistrations.map((entry) => entry.skill.name)).toEqual(['keep-skill'])
    const cwds = env.skillSnapshotCwds.filter((entry) => entry.agentId === 'sub')
    expect(cwds.length).toBeGreaterThan(0)
    expect(cwds.every((entry) => entry.cwd === AUDIO_DIR)).toBe(true)
  })

  it('serves the overview from the scope file and Skill view the subagent uses', async () => {
    const env = subagentEnv()
    apply(env.ctx as never)
    const res = makeRes()
    await env.routeHandler()!(
      makeReqGet('/api/dsh-workspace-scope/overview?sessionId=sub') as never,
      res as never,
    )
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).config).toEqual({
      mode: 'whitelist',
      skills: ['drop-skill'],
      mcps: ['github'],
    })
    expect(env.skillSnapshotCwds).toEqual([{ agentId: 'sub', cwd: AUDIO_DIR }])
  })

  it('saves to the scope file the subagent reads and leaves the root file alone', async () => {
    const env = subagentEnv()
    apply(env.ctx as never)
    const res = makeRes()
    await env.routeHandler()!(
      makeReqPost(
        '/api/dsh-workspace-scope/save',
        JSON.stringify({ sessionId: 'sub', mode: 'blacklist', skills: [], mcps: ['github'] }),
      ) as never,
      res as never,
    )
    expect(JSON.parse(res.body).saved).toBe(true)
    expect(env.state.written.map((entry) => entry.target)).toEqual([AUDIO_FILE])
    expect(env.state.configText).toBe(WHITELIST_TEXT)
  })

  it('refuses to save through a symlinked scope file', async () => {
    const shared = '/ws/scenarios/shared'
    const env = subagentEnv({
      workingDirectory: { sub: shared },
      symlinks: { [`${shared}/.dsh-scope.json`]: AUDIO_FILE },
    })
    apply(env.ctx as never)
    const res = makeRes()
    await env.routeHandler()!(
      makeReqPost('/api/dsh-workspace-scope/save', JSON.stringify({ sessionId: 'sub', mode: 'default' })) as never,
      res as never,
    )
    const body = JSON.parse(res.body) as { saved: boolean; reason: string }
    expect(body.saved).toBe(false)
    expect(body.reason).toMatch(/not a regular file inside the workspace/)
    expect(env.state.written).toEqual([])
  })

  it('creates a missing scope file at the header cwd, never in a subfolder', async () => {
    const env = makeEnv({ configText: undefined, workingDirectory: { sub: AUDIO_DIR } })
    apply(env.ctx as never)
    const res = makeRes()
    await env.routeHandler()!(
      makeReqPost('/api/dsh-workspace-scope/save', JSON.stringify({ sessionId: 'sub', mode: 'whitelist' })) as never,
      res as never,
    )
    expect(JSON.parse(res.body).saved).toBe(true)
    expect(env.state.written.map((entry) => entry.target)).toEqual([ROOT_FILE])
  })

  it('reads the header cwd when DSH has no workingDirectory service', async () => {
    const env = subagentEnv({ workingDirectory: undefined })
    apply(env.ctx as never)

    await env.systemPrompt.assemble({ agent: env.agent('sub'), signal: env.signal })
    expect(env.restrictCalls[0]!.deny).toEqual(['mcp__github__list'])
  })
})
