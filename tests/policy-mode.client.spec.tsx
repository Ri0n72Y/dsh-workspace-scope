// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'

interface OverviewData {
  skills: Array<{ name: string; description: string }>
  mcp: Array<{ server: string; toolCount: number }>
  config: { mode?: string; skills?: string[]; mcps?: string[] }
}

type UseSessions = (sel: (s: unknown) => unknown) => unknown

const useSessions: UseSessions = (sel) => sel({
  current: 's1',
  byId: {
    s1: {
      blank: true,
      projectionValues: { agentPreset: 'writer' },
    },
  },
})

async function mount(overview: OverviewData) {
  vi.resetModules()
  const hostCall = vi.fn((method: string) => {
    if (method === 'overview') return Promise.resolve(overview)
    if (method === 'save') return Promise.resolve({ saved: true })
    return Promise.resolve({})
  })
  vi.stubGlobal('host', { call: hostCall })

  const mod = await import('../src/client/index')
  const seats = new Map<string, (props: unknown) => unknown>()
  const slots = {
    inject: (key: string, cb: () => unknown): void => {
      seats.set(key, cb() as (props: unknown) => unknown)
    },
    register: (_opts: unknown, renderer: unknown): unknown => renderer,
  }
  const ctx = {
    effect: (cb: () => void): (() => void) => { cb(); return () => {} },
    get: (name: string): unknown => name === 'slots' ? slots : undefined,
  }
  mod.apply(ctx as unknown as Context)

  const entry = seats.get('conversation.input.right')
  const modal = seats.get('shell.overlay')
  if (!entry || !modal) throw new Error('workspace-scope seats were not registered')
  render(modal({ useSessions }) as ReactElement)
  render(entry({ useSessions }) as ReactElement)
  fireEvent.click(screen.getByRole('button', { name: '工作区能力' }))
  await waitFor(() => expect(screen.getByRole('dialog', { name: '工作区能力' })).toBeTruthy())
  return hostCall
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('workspace-scope policy mode preservation', () => {
  it('turns default into a blacklist on the first disable without disabling hidden Skills', async () => {
    const hostCall = await mount({
      skills: [{ name: 'skill-a', description: 'a' }],
      mcp: [{ server: 'playwright', toolCount: 1 }],
      // Lists under default are semantically ignored and must not become denies.
      config: { mode: 'default', skills: ['ignored-old'], mcps: ['ignored-mcp'] },
    })

    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(2))
    expect(screen.getByRole('switch', { name: '禁用 skill-a' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch', { name: '禁用 playwright' }))

    await waitFor(() => {
      const calls = hostCall.mock.calls.filter(([method]) => method === 'save')
      const payload = calls[calls.length - 1]?.[1] as {
        mode: string
        skills: string[]
        mcps: string[]
      } | undefined
      expect(payload).toMatchObject({ mode: 'blacklist', skills: [], mcps: ['playwright'] })
    })
  })

  it('keeps hidden blacklist entries while editing the current preset', async () => {
    const hostCall = await mount({
      skills: [
        { name: 'skill-a', description: 'a' },
        { name: 'skill-b', description: 'b' },
      ],
      mcp: [],
      config: {
        mode: 'blacklist',
        skills: ['skill-b', 'hidden-skill'],
        mcps: ['hidden-mcp'],
      },
    })

    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(2))
    expect(screen.getByRole('switch', { name: '禁用 skill-a' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: '启用 skill-b' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('switch', { name: '禁用 skill-a' }))

    await waitFor(() => {
      const calls = hostCall.mock.calls.filter(([method]) => method === 'save')
      const payload = calls[calls.length - 1]?.[1] as {
        mode: string
        skills: string[]
        mcps: string[]
      } | undefined
      expect(payload?.mode).toBe('blacklist')
      expect(new Set(payload?.skills)).toEqual(new Set(['skill-a', 'skill-b', 'hidden-skill']))
      expect(payload?.mcps).toEqual(['hidden-mcp'])
    })
  })
})