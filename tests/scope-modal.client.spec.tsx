// @vitest-environment jsdom
/**
 * Client behavior tests. They mount through the real plugin entry (apply +
 * slots registration), mock only the RPC boundary (host.call) and the
 * framework hook (useSessions), and assert user-visible behavior: dialog
 * content, counts, switch states, save feedback. No class-name assertions,
 * no DOM internals, no style assertions (dsh convention,
 * packages/client/AGENTS.md: component specs assert user-visible behavior).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { Context } from '@deepseek-ai/cordis'

interface OverviewData {
  skills: Array<{ name: string; description: string }>
  mcp: Array<{ server: string; toolCount: number }>
  config: { mode?: string; skills?: string[]; mcps?: string[] }
}

function makeOverview(over: Partial<OverviewData> = {}): OverviewData {
  return {
    skills: [
      { name: 'skill-a', description: 'desc of skill-a' },
      { name: 'skill-b', description: 'desc of skill-b' },
      { name: 'skill-c', description: 'desc of skill-c' },
    ],
    mcp: [{ server: 'playwright', toolCount: 24 }],
    config: { mode: 'whitelist', skills: ['skill-a', 'skill-b'], mcps: ['playwright'] },
    ...over,
  }
}

type UseSessions = (sel: (s: unknown) => unknown) => unknown

function sessions(sessionId: string | undefined, blank: boolean): UseSessions {
  return (sel) => sel({
    current: sessionId,
    byId: sessionId === undefined ? {} : { [sessionId]: { blank } },
  })
}

interface Mounted {
  hostCall: ReturnType<typeof vi.fn>
  /** Render the new-session-screen entry (hero chip). */
  renderEntries: (useSessions?: UseSessions) => void
  renderModal: (useSessions?: UseSessions) => void
  rerenderModal: (useSessions?: UseSessions) => void
}

/** Fresh module per test (the modal open state is module-scoped), then mount
 *  the real apply() against a fake slots service and capture the registered
 *  renderers. */
async function mount(hostImpl?: (method: string, args: unknown) => Promise<unknown>): Promise<Mounted> {
  vi.resetModules()
  const hostCall = vi.fn(hostImpl ?? ((method: string) => {
    if (method === 'overview') return Promise.resolve(makeOverview())
    if (method === 'save') return Promise.resolve({ saved: true })
    return Promise.resolve({})
  }))
  vi.stubGlobal('host', { call: hostCall })

  const mod = await import('../src/client/index')
  const seats = new Map<string, (props: unknown) => unknown>()
  const slots = {
    inject: (key: string, cb: () => unknown): unknown => {
      seats.set(key, cb() as (props: unknown) => unknown)
      return undefined
    },
    register: (_opts: unknown, renderer: unknown): unknown => renderer,
  }
  const ctx = {
    effect: (cb: () => void): (() => void) => { cb(); return () => {} },
    get: (name: string): unknown => (name === 'slots' ? slots : undefined),
  }
  mod.apply(ctx as unknown as Context)

  const seat = (key: string): ((props: unknown) => unknown) => {
    const renderer = seats.get(key)
    if (!renderer) throw new Error(`seat not registered: ${key}`)
    return renderer
  }
  const modalRenderer = seat('shell.overlay')
  let modalView: ReturnType<typeof render> | undefined

  return {
    hostCall,
    renderEntry: (useSessions) => {
      render(seat('conversation.input.right')({ useSessions }) as ReactElement)
    },
    renderModal: (useSessions) => {
      modalView = render(modalRenderer({ useSessions }) as ReactElement)
    },
    rerenderModal: (useSessions) => {
      if (!modalView) throw new Error('modal not rendered yet')
      modalView.rerender(modalRenderer({ useSessions }) as ReactElement)
    },
  }
}

function openDialog(): void {
  fireEvent.click(screen.getByRole('button', { name: '工作区能力' }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('workspace-scope client', () => {
  it('opens the dialog and shows both groups with the saved enablement', async () => {
    const m = await mount()
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))

    openDialog()
    await waitFor(() => expect(screen.getByRole('dialog', { name: '工作区能力' })).toBeTruthy())
    expect(screen.getByRole('heading', { name: /技能/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /MCP 服务器/ })).toBeTruthy()

    await waitFor(() => {
      const switches = screen.getAllByRole('switch')
      expect(switches).toHaveLength(4) // 3 skills + 1 mcp
      // enablement comes from the saved config
      expect(switches[0].getAttribute('aria-checked')).toBe('true') // skill-a in whitelist
      expect(switches[2].getAttribute('aria-checked')).toBe('false') // skill-c not in whitelist
    })
  })

  it('filters entries through the search box and updates counts', async () => {
    const m = await mount()
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    openDialog()
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(4))

    const search = screen.getByRole('searchbox', { name: '搜索技能或 MCP' })
    fireEvent.change(search, { target: { value: 'playwright' } })

    await waitFor(() => {
      expect(screen.getAllByRole('switch')).toHaveLength(1)
      expect(screen.getByText('playwright')).toBeTruthy()
      expect(screen.queryByText('skill-a')).toBeNull()
    })

    fireEvent.change(search, { target: { value: 'zzz' } })
    await waitFor(() => expect(screen.getByText('没有匹配的技能。')).toBeTruthy())
  })

  it('expands and collapses a row to reveal details', async () => {
    const m = await mount()
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    openDialog()
    await waitFor(() => expect(screen.getByText('skill-a')).toBeTruthy())

    fireEvent.click(screen.getByText('skill-a'))
    await waitFor(() => expect(screen.getByText('desc of skill-a')).toBeTruthy())
    expect(screen.getByText('会话中可用 /skill-a 临时加载')).toBeTruthy()

    fireEvent.click(screen.getByText('skill-a'))
    await waitFor(() => expect(screen.queryByText('desc of skill-a')).toBeNull())
  })

  it('toggles a row with its switch and keeps the expanded state', async () => {
    const m = await mount()
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    openDialog()
    await waitFor(() => expect(screen.getByText('skill-a')).toBeTruthy())

    fireEvent.click(screen.getByText('skill-a'))
    await waitFor(() => expect(screen.getByText('desc of skill-a')).toBeTruthy())

    const firstSwitch = screen.getAllByRole('switch')[0]
    expect(firstSwitch.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(firstSwitch)
    await waitFor(() => expect(firstSwitch.getAttribute('aria-checked')).toBe('false'))
    expect(screen.getByText('desc of skill-a')).toBeTruthy() // details stayed open
    expect(screen.getAllByText('已禁用').length).toBeGreaterThan(0)
  })

  it('enable all / disable all flip every row and autosave sends the full set', async () => {
    const m = await mount()
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    openDialog()
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(4))

    fireEvent.click(screen.getByRole('button', { name: '全部禁用' }))
    await waitFor(() => {
      expect(screen.getAllByRole('switch').every((s) => s.getAttribute('aria-checked') === 'false')).toBe(true)
    })
    // the change persisted without any explicit save button
    await waitFor(() => {
      const payload = m.hostCall.mock.calls.find(([method]) => method === 'save')?.[1] as
        { mode: string; skills: string[]; mcps: string[] }
      expect(payload).toBeTruthy()
      expect(payload.mode).toBe('whitelist')
      expect(payload.skills).toEqual([])
      expect(payload.mcps).toEqual([])
    })

    fireEvent.click(screen.getByRole('button', { name: '全部启用' }))
    await waitFor(() => {
      expect(screen.getAllByRole('switch').every((s) => s.getAttribute('aria-checked') === 'true')).toBe(true)
    })
    await waitFor(() => {
      const calls = m.hostCall.mock.calls.filter(([method]) => method === 'save')
      const payload = calls[calls.length - 1]![1] as { mode: string; skills: string[]; mcps: string[] }
      expect(payload.mode).toBe('whitelist')
      expect(payload.skills).toEqual(['skill-a', 'skill-b', 'skill-c'])
      expect(payload.mcps).toEqual(['playwright'])
    })
  })

  it('reports autosave success and failure distinctly', async () => {
    const m = await mount()
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    openDialog()
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(4))

    // any change triggers the autosave; success shows the confirmation
    fireEvent.click(screen.getAllByRole('switch')[0])
    await waitFor(() => expect(screen.getByText('已保存 ✓（生效于该工作区的新对话）')).toBeTruthy())

    m.hostCall.mockImplementation((method: string) => {
      if (method === 'overview') return Promise.resolve(makeOverview())
      if (method === 'save') return Promise.resolve({ saved: false, reason: '权限不足' })
      return Promise.resolve({})
    })
    fireEvent.click(screen.getAllByRole('switch')[0])
    await waitFor(() => expect(screen.getByText('保存失败：权限不足')).toBeTruthy())
  })

  it('closes via Escape and via the backdrop, focusing the dialog on open', async () => {
    const m = await mount()
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    openDialog()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(document.activeElement?.getAttribute('role')).toBe('dialog')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    openDialog()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    // click the backdrop (outside the panel) to close
    fireEvent.click(screen.getByRole('dialog').parentElement!.querySelector('.wsc-mask') as Element)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('collapses a whole group from its heading', async () => {
    const m = await mount()
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    openDialog()
    await waitFor(() => expect(screen.getByText('skill-a')).toBeTruthy())

    fireEvent.click(screen.getByRole('heading', { name: /技能/ }))
    await waitFor(() => expect(screen.queryByText('skill-a')).toBeNull())
    expect(screen.getByText('playwright')).toBeTruthy() // the MCP group stays

    fireEvent.click(screen.getByRole('heading', { name: /技能/ }))
    await waitFor(() => expect(screen.getByText('skill-a')).toBeTruthy())
  })

  it('reloads data when the session switches while open', async () => {
    const m = await mount((method: string, args: unknown) => {
      const sessionId = (args as { sessionId?: string }).sessionId ?? ''
      if (method === 'overview') {
        return Promise.resolve(sessionId === 's2'
          ? makeOverview({
            skills: [{ name: 'other-skill', description: 'other desc' }],
            mcp: [],
            config: { mode: 'whitelist', skills: ['other-skill'], mcps: [] },
          })
          : makeOverview())
      }
      return Promise.resolve({ saved: true })
    })
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    openDialog()
    await waitFor(() => expect(screen.getByText('skill-a')).toBeTruthy())

    m.rerenderModal(sessions('s2', true))
    await waitFor(() => {
      expect(screen.getByText('other-skill')).toBeTruthy()
      expect(screen.queryByText('skill-a')).toBeNull()
    })
  })

  it('reads a legacy blacklist config as the inverted enablement', async () => {
    const m = await mount((method: string) => {
      if (method === 'overview') {
        return Promise.resolve(makeOverview({
          mcp: [],
          config: { mode: 'blacklist', skills: ['skill-b'], mcps: [] },
        }))
      }
      return Promise.resolve({ saved: true })
    })
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    openDialog()
    await waitFor(() => {
      const switches = screen.getAllByRole('switch')
      expect(switches).toHaveLength(3) // no mcp in this config
      // blacklist means checked = excluded: skill-b shows disabled, the rest enabled
      expect(switches[0].getAttribute('aria-checked')).toBe('true') // skill-a
      expect(switches[1].getAttribute('aria-checked')).toBe('false') // skill-b excluded
      expect(switches[2].getAttribute('aria-checked')).toBe('true') // skill-c
    })
  })

  it('clears the search term when the dialog reopens', async () => {
    const m = await mount()
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    openDialog()
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(4))

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索技能或 MCP' }), { target: { value: 'skill-a' } })
    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(1))

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    openDialog()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect((screen.getByRole('searchbox', { name: '搜索技能或 MCP' }) as HTMLInputElement).value).toBe('')
  })

  it('traps Tab focus inside the dialog', async () => {
    const m = await mount()
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    openDialog()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    const panel = screen.getByRole('dialog')
    const focusables = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
    expect(focusables.length).toBeGreaterThan(1)

    // Tab on the last focusable wraps to the first
    focusables[focusables.length - 1]!.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(focusables[0])

    // Shift+Tab on the first wraps to the last
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(focusables[focusables.length - 1])

    // Tab from outside the dialog (focus lost to the page) enters it
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(focusables[0])
  })

  it('shows the entry only on the new-session screen', async () => {
    const m = await mount()
    // new-session screen (blank): the chip is present
    m.renderModal(sessions('s1', true))
    m.renderEntry(sessions('s1', true))
    expect(screen.getAllByRole('button', { name: '工作区能力' })).toHaveLength(1)

    cleanup()

    // ongoing conversation: no entry at all
    m.renderModal(sessions('s1', false))
    m.renderEntry(sessions('s1', false))
    expect(screen.queryByRole('button', { name: '工作区能力' })).toBeNull()
  })
})
