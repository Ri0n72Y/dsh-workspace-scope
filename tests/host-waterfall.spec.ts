/**
 * Host waterfall integration: proves the prepend-outermost pre-step listener
 * filters the catalog AFTER tool-skill appends the full one at the end of
 * the chain. Simulates the Cordis waterfall dispatch order around a
 * tool-skill-shaped listener.
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index'

const WHITELIST = { mode: 'whitelist', skills: ['keep-a', 'keep-c'], mcps: [] }
const FULL_ENTRIES = [
  { name: 'keep-a', description: 'a' },
  { name: 'drop-b', description: 'b' },
  { name: 'keep-c', description: 'c' },
]

function makeCtx() {
  const listeners: Array<{ fn: (...args: never[]) => unknown; prepend?: boolean }> = []
  const ctx = {
    get: (name: string): unknown => {
      if (name === 'webServer') return { register: () => () => {} }
      if (name === 'fs') {
        return {
          resolve: async (p: string): Promise<string> => p,
          readText: async (): Promise<string> => JSON.stringify({ default: WHITELIST }),
          writeText: async (): Promise<void> => undefined,
        }
      }
      return undefined
    },
    effect: (cb: () => void): (() => void) => { cb(); return () => {} },
    on: (name: string, fn: (...args: never[]) => unknown, options?: boolean | { prepend?: boolean }): (() => boolean) => {
      if (name !== 'agent/pre-step') return () => true
      const prepend = options === true || (options !== undefined && typeof options === 'object' && options.prepend === true)
      if (prepend) listeners.unshift({ fn, prepend })
      else listeners.push({ fn })
      return () => true
    },
  }
  return { ctx, listeners }
}

/** Cordis waterfall dispatch: listeners outermost-first, each wrapping next(). */
async function dispatch(
  cbs: Array<(...args: unknown[]) => unknown>,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const queue = [...cbs]
  const inner = async (): Promise<unknown> => ({ kind: 'enter', messages: payload.messages })
  const next = (): unknown => {
    const cb = queue.shift() ?? inner
    return cb(payload, next)
  }
  return next()
}

/** tool-skill-shaped listener: appends the full catalog at the end of the chain. */
async function toolSkillLike(payload: Record<string, unknown>, next: () => unknown): Promise<unknown> {
  const decision = (await next()) as { kind: string; messages?: Array<Record<string, unknown>> }
  if (decision.kind === 'reject') return decision
  const catalog = {
    role: 'user',
    content: [{ type: 'text', text: '<system-reminder>…' }],
    source: { kind: 'skill-catalog', form: 'catalog', entries: FULL_ENTRIES },
  }
  return { kind: 'enter', messages: [...(decision.messages ?? []), catalog] }
}

describe('pre-step catalog trim vs the waterfall', () => {
  it('filters the catalog appended by an earlier-registered tool-skill listener', async () => {
    const { ctx, listeners } = makeCtx()
    apply(ctx as never)

    // Registration order in the real host: tool-skill (host boot) pushes
    // first, then our inner listener pushes, then our trim listener prepends
    // to the very front. Dispatch order = [trim, tool-skill, inner].
    expect(listeners).toHaveLength(2) // trim (prepend) + config (push)
    const cbs = [listeners[0]!.fn, toolSkillLike, listeners[1]!.fn]

    const payload = {
      agent: { id: 'a1', session: { header: { cwd: '/ws' } } },
      messages: [],
      signal: { throwIfAborted: () => {} },
    }
    const result = (await dispatch(cbs, payload)) as { kind: string; messages: Array<Record<string, unknown>> }

    const catalogs = result.messages.filter((m) =>
      (m.source as { kind?: string })?.kind === 'skill-catalog')
    expect(catalogs).toHaveLength(1)
    const entries = (catalogs[0]!.source as { entries: Array<{ name: string }> }).entries
    expect(entries.map((e) => e.name)).toEqual(['keep-a', 'keep-c'])
    expect(entries.map((e) => e.name)).not.toContain('drop-b')
  })

  it('keeps the full catalog untouched in default mode', async () => {
    const { ctx, listeners } = makeCtx()
    // default mode: readConfig returns defaults (fs mock returns whitelist,
    // so override by pointing at an empty store: fs undefined → default)
    const ctx2 = {
      ...ctx,
      get: (name: string): unknown => {
        if (name === 'webServer') return { register: () => () => {} }
        return undefined // no fs → DEFAULT_CONFIG (mode default)
      },
    }
    const listeners2: Array<{ fn: (...args: never[]) => unknown; prepend?: boolean }> = []
    const ctxOn = ctx2 as { on: (...args: never[]) => unknown }
    const realOn = ctxOn.on.bind(ctx2)
    ctx2.on = ((name: string, fn: (...args: never[]) => unknown, options?: boolean | { prepend?: boolean }) => {
      if (name !== 'agent/pre-step') return () => true
      const prepend = options === true || (options !== undefined && typeof options === 'object' && options.prepend === true)
      if (prepend) listeners2.unshift({ fn, prepend })
      else listeners2.push({ fn })
      return () => true
    }) as never
    apply(ctx2 as never)

    const cbs = [listeners2[0]!.fn, toolSkillLike, listeners2[1]!.fn]
    const payload = {
      agent: { id: 'a2', session: { header: { cwd: '/ws' } } },
      messages: [],
      signal: { throwIfAborted: () => {} },
    }
    const result = (await dispatch(cbs, payload)) as { kind: string; messages: Array<Record<string, unknown>> }
    const catalogs = result.messages.filter((m) =>
      (m.source as { kind?: string })?.kind === 'skill-catalog')
    expect(catalogs).toHaveLength(1)
    const entries = (catalogs[0]!.source as { entries: Array<{ name: string }> }).entries
    expect(entries).toHaveLength(FULL_ENTRIES.length)
  })
})
