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

/** ctx stub: fs present by default (whitelist config), pass { fs: false }
 *  to simulate default-mode (no fs → DEFAULT_CONFIG). */
function makeCtx(opts: { fs?: boolean } = {}) {
  const listeners: Array<{ fn: (...args: never[]) => unknown; prepend?: boolean }> = []
  const ctx = {
    get: (name: string): unknown => {
      if (name === 'webServer') return { register: () => () => {} }
      if (name === 'fs' && opts.fs !== false) {
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
async function toolSkillLike(payload: Record<string, unknown>, next: () => unknown, form: 'catalog' | 'update' = 'catalog'): Promise<unknown> {
  const decision = (await next()) as { kind: string; messages?: Array<Record<string, unknown>> }
  if (decision.kind === 'reject') return decision
  const catalog = {
    role: 'user',
    content: [{ type: 'text', text: '<system-reminder>…' }],
    source: { kind: 'skill-catalog', form, update: form === 'update' ? true : undefined, entries: FULL_ENTRIES },
  }
  return { kind: 'enter', messages: [...(decision.messages ?? []), catalog] }
}

function payloadOf(agentId: string): Record<string, unknown> {
  return {
    agent: { id: agentId, session: { header: { cwd: '/ws' } } },
    messages: [],
    signal: { throwIfAborted: () => {} },
  }
}

function catalogMessages(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return messages.filter((m) => (m.source as { kind?: string })?.kind === 'skill-catalog')
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

    const result = (await dispatch(cbs, payloadOf('a1'))) as { kind: string; messages: Array<Record<string, unknown>> }

    const catalogs = catalogMessages(result.messages)
    expect(catalogs).toHaveLength(1)
    const entries = (catalogs[0]!.source as { entries: Array<{ name: string }> }).entries
    expect(entries.map((e) => e.name)).toEqual(['keep-a', 'keep-c'])
    expect(entries.map((e) => e.name)).not.toContain('drop-b')
  })

  it('trims an update-form catalog and keeps the update marker', async () => {
    const { ctx, listeners } = makeCtx()
    apply(ctx as never)

    const updateLike = (p: Record<string, unknown>, n: () => unknown): Promise<unknown> => toolSkillLike(p, n, 'update')
    const cbs = [listeners[0]!.fn, updateLike, listeners[1]!.fn]
    const result = (await dispatch(cbs, payloadOf('a2'))) as { kind: string; messages: Array<Record<string, unknown>> }

    const catalogs = catalogMessages(result.messages)
    expect(catalogs).toHaveLength(1)
    const src = catalogs[0]!.source as { form: string; update?: boolean; entries: Array<{ name: string }> }
    expect(src.form).toBe('update')
    expect(src.update).toBe(true)
    expect(src.entries.map((e) => e.name)).toEqual(['keep-a', 'keep-c'])
  })

  it('keeps the full catalog untouched in default mode', async () => {
    const { ctx, listeners } = makeCtx({ fs: false }) // no fs → DEFAULT_CONFIG (mode default)
    apply(ctx as never)

    const cbs = [listeners[0]!.fn, toolSkillLike, listeners[1]!.fn]
    const result = (await dispatch(cbs, payloadOf('a3'))) as { kind: string; messages: Array<Record<string, unknown>> }

    const catalogs = catalogMessages(result.messages)
    expect(catalogs).toHaveLength(1)
    const entries = (catalogs[0]!.source as { entries: Array<{ name: string }> }).entries
    expect(entries).toHaveLength(FULL_ENTRIES.length)
  })

  it('passes a mid-chain reject through untouched (inner config listener skipped)', async () => {
    const { ctx, listeners } = makeCtx()
    apply(ctx as never)

    // A vetoing listener sits between the trim and the config listeners and
    // never calls next(): the inner config listener never runs, so the trim
    // listener must forward the reject exactly as produced.
    const veto = async (): Promise<unknown> => ({ kind: 'reject', reason: 'vetoed' })
    const cbs = [listeners[0]!.fn, veto, listeners[1]!.fn]
    const result = (await dispatch(cbs, payloadOf('a4'))) as { kind: string; reason?: string }

    expect(result.kind).toBe('reject')
    expect(result.reason).toBe('vetoed')
  })

  it('propagates an aborted signal as a failed proposal', async () => {
    const { ctx, listeners } = makeCtx()
    apply(ctx as never)

    // The inner listener throws on abort after the chain below it resolves;
    // tool-skill and the trim listener have no catch, so the whole waterfall
    // rejects and agent-loop turns that into a failed proposal.
    const cbs = [listeners[0]!.fn, toolSkillLike, listeners[1]!.fn]
    const payload = {
      agent: { id: 'a5', session: { header: { cwd: '/ws' } } },
      messages: [],
      signal: { throwIfAborted: (): never => { throw new Error('aborted') } },
    }
    await expect(dispatch(cbs, payload)).rejects.toThrow('aborted')
  })

  it('does not trim when a mid-chain enter-veto skips the config listener on the first step', async () => {
    const { ctx, listeners } = makeCtx()
    apply(ctx as never)

    // An enter-vetoing listener between trim and config returns a decision
    // without calling next(): on the very first step no config is locked, so
    // the trim must pass the full catalog through untouched (no crash).
    const fullCatalog = {
      role: 'user',
      content: [{ type: 'text', text: '<system-reminder>…' }],
      source: { kind: 'skill-catalog', form: 'catalog', entries: FULL_ENTRIES },
    }
    const vetoEnter = async (): Promise<unknown> => ({ kind: 'enter', messages: [fullCatalog] })
    const cbs = [listeners[0]!.fn, vetoEnter, listeners[1]!.fn]
    const result = (await dispatch(cbs, payloadOf('a6'))) as { kind: string; messages: Array<Record<string, unknown>> }

    expect(result.kind).toBe('enter')
    const catalogs = catalogMessages(result.messages)
    expect(catalogs).toHaveLength(1)
    const entries = (catalogs[0]!.source as { entries: Array<{ name: string }> }).entries
    expect(entries).toHaveLength(FULL_ENTRIES.length)
  })
})
