/**
 * workspace-scope — Client half (TSX).
 *
 * 按工作区（工程）启停 Skill 与 MCP。入口只在新建会话界面（hero）：
 * 输入卡右侧工具行（conversation.input.right）的紧凑 chip；已进行的
 * 对话不显示入口（配置在会话开始时锁定，修改只影响该工作区的新对话）。
 * 弹窗样式参考「设置 → 插件」页（搜索框 + 分组计数 + 卡片网格）。
 * Skill 与 MCP 全部条目始终展示，勾选即启用（白名单语义），
 * 提供 全部启用 / 全部禁用 快捷按钮，改动即时保存。配置只影响新对话开场。
 *
 * 数据通道双环境：动态（plugin-dev-loop）client 沙箱禁止 fetch，走
 * host.call；静态 bundle 走 /api/workspace-scope 路由。
 *
 * @module workspace-scope/client
 */

import React from 'react'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'workspace-scope-client'

// Hard dependency: wait for the slots service before registering UI, so the
// contribution can never silently race the shell's boot.
export const inject = ['slots']

// Dual-environment data channel: the dynamic (plugin-dev-loop) client sandbox
// provides the `host` binding (fetch is forbidden there); the static bundle
// has none (typeof guard) and fetches the webServer routes instead.
declare const host: any

function callHost(method: string, args: unknown): Promise<any> {
  if (typeof host !== 'undefined') return host.call(method, args)
  const handle = async (res: Response): Promise<any> => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<any>
  }
  if (method === 'overview') {
    const sessionId = (args as { sessionId?: string })?.sessionId ?? ''
    return fetch(`/api/workspace-scope/overview?sessionId=${encodeURIComponent(sessionId)}`).then(handle)
  }
  return fetch('/api/workspace-scope/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  }).then(handle)
}

// ── styles ──────────────────────────────────────────────────────────────────
// Bar/chip mirror AgentPresetSeat; modal chrome mirrors SettingsRoot; the
// modal body follows the plugin inventory page (PluginInventorySettingsTab):
// search field, section heading with count, card grid, status tag.

const CSS = [
  // Compact chip inside the hero composer tool row. Chrome mirrors the
  // sibling model-select trigger (ModelSelect.module.css .trigger): same
  // height, pill radius, transparent background and focus ring, so the row
  // reads as one set of controls.
  '.wsc-chip{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:220px;height:28px;padding:0 4px 0 8px;border:none;border-radius:24px;outline:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-weight:500;font-family:inherit;cursor:pointer}',
  '.wsc-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.wsc-chip:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}',
  '.wsc-chip .wsc-chevron{flex:none;color:var(--dsw-alias-label-caption)}',
  '.wsc-seat-icon{flex:none;color:var(--dsw-alias-label-primary)}',
  // Modal mirrors the settings shell: full-viewport mask + centered panel.
  '.wsc-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;pointer-events:none}',
  '.wsc-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur);pointer-events:auto}',
  '.wsc-panel{position:relative;z-index:1;display:flex;flex-direction:column;width:min(760px,calc(100vw - 48px));height:min(680px,calc(100vh - 48px));max-width:calc(100vw - 48px);border-radius:24px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv3);pointer-events:auto;color:var(--dsw-alias-label-primary)}',
  '.wsc-panel-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;height:54px;padding:8px 14px 8px 24px;box-sizing:border-box}',
  '.wsc-panel-title{font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}',
  '.wsc-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:28px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-primary)}',
  '.wsc-close:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  // Body: plugin-inventory rhythm (search, heading+count, card grid).
  '.wsc-panel-body{flex:1;min-height:0;padding:4px 24px 24px;overflow-y:auto;font-size:13px}',
  '.wsc-body{display:flex;flex-direction:column;gap:14px;width:100%;max-width:760px;color:var(--dsw-alias-label-primary)}',
  '.wsc-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6;margin:0}',
  '.wsc-search{position:relative;display:flex;align-items:center;width:100%;color:var(--dsw-alias-label-tertiary)}',
  '.wsc-search > svg{position:absolute;left:12px;pointer-events:none}',
  '.wsc-search input{width:100%;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:0 34px 0 36px;outline:none;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;box-sizing:border-box}',
  '.wsc-search input::placeholder{color:var(--dsw-alias-label-tertiary)}',
  '.wsc-search input:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}',
  '.wsc-heading{display:flex;align-items:center;gap:7px;width:100%;padding:4px 2px;margin:0;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.wsc-heading:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.wsc-heading:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
  '.wsc-heading h3{font-size:13px;line-height:20px;font-weight:600;margin:0}',
  '.wsc-heading span{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
  '.wsc-heading-chevron{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary)}',
  ".wsc-heading[data-collapsed='true'] .wsc-heading-chevron{transform:rotate(-90deg)}",
  '.wsc-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:10px;margin:0;padding:0;list-style:none}',
  // Card row: switch + expandable name row (mirrors the plugin inventory
  // page: one line, details revealed on click).
  '.wsc-card{min-width:0;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}',
  ".wsc-card[data-open='true']{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}",
  '.wsc-card-main{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:12px 14px}',
  '.wsc-row{flex:1;min-width:0;display:flex;align-items:center;gap:7px;border:0;padding:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.wsc-row:hover,.wsc-card[data-open=\'true\'] .wsc-row{background:var(--dsw-alias-interactive-bg-hover)}',
  '.wsc-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}',
  '.wsc-card-title{flex:1;min-width:0;overflow:hidden;font-size:14px;line-height:20px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}',
  '.wsc-tag{display:inline-flex;flex:none;align-items:center;min-height:20px;border-radius:5px;padding:1px 6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap}',
  '.wsc-tag[data-enabled="true"]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}',
  '.wsc-chevron{flex:none;color:var(--dsw-alias-label-tertiary)}',
  ".wsc-card[data-open='true'] .wsc-chevron{transform:rotate(180deg)}",
  // Details revealed below the row (plugin inventory cardDetails rhythm).
  '.wsc-card-details{border-top:1px solid var(--dsw-alias-border-l2);padding:10px 14px 12px;background:var(--dsw-alias-bg-module-platform)}',
  '.wsc-detail-desc{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}',
  '.wsc-details{display:grid;grid-template-columns:76px minmax(0,1fr);gap:6px 10px;margin:8px 0 0}',
  '.wsc-details div{display:contents}',
  '.wsc-details dt{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}',
  '.wsc-details dd{min-width:0;margin:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px}',
  // Self-drawn switch: theme tokens only, so a dsh theme switch re-skins it
  // automatically (no hardcoded colors).
  '.wsc-switch{display:inline-flex;flex:none;align-items:center;padding:0;border:0;background:transparent;cursor:pointer;border-radius:999px}',
  '.wsc-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
  '.wsc-switch-track{position:relative;display:inline-block;width:28px;height:16px;border-radius:999px;background:var(--dsw-alias-border-l2);transition:background-color 120ms var(--ds-ease-in-out)}',
  ".wsc-switch-track[data-on='true']{background:var(--dsw-alias-state-business-primary)}",
  '.wsc-switch-thumb{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);transition:transform 120ms var(--ds-ease-in-out)}',
  ".wsc-switch-track[data-on='true'] .wsc-switch-thumb{transform:translateX(12px)}",
  '@media (prefers-reduced-motion: no-preference){.wsc-chevron,.wsc-heading-chevron{transition:transform 140ms var(--ds-ease-in-out)}}',
  '.wsc-actions{display:flex;gap:8px;align-items:center;margin-top:4px}',
  '.wsc-btn{font-size:13px;line-height:22px;padding:4px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;cursor:pointer;font-family:inherit}',
  '.wsc-btn:hover{border-color:var(--dsw-alias-border-l2)}',
  '.wsc-btn:disabled{opacity:.6;cursor:default}',
  '.wsc-save{border-color:var(--dsw-alias-brand-primary)}',
  '.wsc-notice{font-size:12px;color:var(--dsw-alias-state-success-primary);margin:0}',
  '.wsc-error{font-size:12px;color:var(--dsw-alias-state-error-primary);margin:0}',
  '.wsc-hint{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6;margin:0}',
  '@media (max-width: 680px){.wsc-cards{grid-template-columns:minmax(0,1fr)}}',
].join('\n')

// ── shared modal open state between the bar and the overlay modal ───────────

let modalOpen = false
const modalListeners = new Set<() => void>()

function setModal(open: boolean): void {
  modalOpen = open
  for (const fn of modalListeners) fn()
}

function useModalOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = React.useState(modalOpen)
  React.useEffect(() => {
    const fn = (): void => setOpenState(modalOpen)
    modalListeners.add(fn)
    return () => { modalListeners.delete(fn) }
  }, [])
  return [open, setModal]
}

// ── icons (exact glyphs from @deepseek-ai/dsh-client-ui-primitives) ─────────

function PresetIcon(props: { className?: string }): React.ReactElement {
  const maskId = 'wscmask' + Math.floor(Math.random() * 1e9)
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" className={props.className}>
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
        <rect width="16" height="16" fill="white" />
        <circle cx="7.9995" cy="3.28319" r="1.712" fill="black" />
        <circle cx="3.51122" cy="11.3855" r="1.712" fill="black" />
        <circle cx="12.4878" cy="11.3855" r="1.712" fill="black" />
      </mask>
      <path mask={`url(#${maskId})`} fill="currentColor" d="M12.2881 11.0425C12.6002 11.3723 13.0413 11.5786 13.5312 11.5786L13.5342 11.5776C13.1476 12.3233 12.6119 12.9785 11.9639 13.5005C10.9327 14.3309 9.6199 14.8286 8.19336 14.8286C7.29864 14.8285 6.45056 14.6313 5.6875 14.2808C6.08309 14.0281 6.36707 13.6189 6.45215 13.1392C6.99022 13.3561 7.57767 13.476 8.19336 13.4761C9.30019 13.4761 10.3157 13.0915 11.1152 12.4478C11.5935 12.0626 11.9924 11.5848 12.2881 11.0425ZM4.14746 4.36475C4.25569 4.83228 4.55488 5.2247 4.95898 5.4585C4.07956 6.30639 3.53144 7.49605 3.53125 8.81396C3.53125 9.69534 3.77613 10.5202 4.20117 11.2231C3.74959 11.3817 3.38395 11.7232 3.19531 12.1597C2.5541 11.2032 2.17969 10.052 2.17969 8.81396C2.17989 7.05087 2.93868 5.4646 4.14746 4.36475ZM8.19336 2.80029C8.85717 2.80029 9.49784 2.90834 10.0967 3.10791C12.3237 3.85044 13.9725 5.86061 14.1846 8.28369C13.9832 8.20048 13.7627 8.15382 13.5312 8.15381C13.2802 8.15381 13.042 8.20907 12.8271 8.30615C12.6281 6.47264 11.3666 4.95616 9.66895 4.39014C9.2063 4.236 8.70989 4.15186 8.19336 4.15186C7.96112 4.15189 7.7329 4.16981 7.50977 4.20264C7.51947 4.12886 7.52637 4.05348 7.52637 3.97705C7.52628 3.56604 7.3811 3.18914 7.13965 2.89404C7.48183 2.83352 7.83381 2.80033 8.19336 2.80029Z" />
      <path fill="currentColor" d="M9.1123 3.28271C9.11205 2.66858 8.61322 2.17041 7.99902 2.17041C7.38504 2.17067 6.88697 2.66874 6.88672 3.28271C6.88672 3.89691 7.38489 4.39574 7.99902 4.396C8.61338 4.396 9.1123 3.89707 9.1123 3.28271ZM10.3115 3.28271C10.3115 4.55981 9.27612 5.59521 7.99902 5.59521C6.72214 5.59496 5.6875 4.55965 5.6875 3.28271C5.68776 2.00599 6.7223 0.971447 7.99902 0.971191C9.27596 0.971191 10.3113 2.00584 10.3115 3.28271Z" />
      <path fill="currentColor" d="M4.62402 11.385C4.62377 10.7709 4.12494 10.2727 3.51074 10.2727C2.89676 10.273 2.39869 10.771 2.39844 11.385C2.39844 11.9992 2.89661 12.498 3.51074 12.4983C4.1251 12.4983 4.62402 11.9994 4.62402 11.385ZM5.82324 11.385C5.82324 12.6621 4.78784 13.6975 3.51074 13.6975C2.23386 13.6973 1.19922 12.6619 1.19922 11.385C1.19947 10.1083 2.23402 9.07374 3.51074 9.07349C4.78768 9.07349 5.82299 10.1081 5.82324 11.385Z" />
      <path fill="currentColor" d="M13.6006 11.385C13.6003 10.7709 13.1015 10.2727 12.4873 10.2727C11.8733 10.273 11.3753 10.771 11.375 11.385C11.375 11.9992 11.8732 12.498 12.4873 12.4983C13.1017 12.4983 13.6006 11.9994 13.6006 11.385ZM14.7998 11.385C14.7998 12.6621 13.7644 13.6975 12.4873 13.6975C11.2104 13.6973 10.1758 12.6619 10.1758 11.385C10.176 10.1083 11.2106 9.07374 12.4873 9.07349C13.7642 9.07349 14.7995 10.1081 14.7998 11.385Z" />
    </svg>
  )
}

function ChevronIcon(props: { className?: string }): React.ReactElement {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" className={props.className}>
      <path fill="currentColor" d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z" />
    </svg>
  )
}

function SearchIcon(): React.ReactElement {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fill="currentColor" d="M11.894845 6.647401C11.894845 3.725463 9.534486 1.356779 6.623219 1.35657C3.711786 1.35657 1.351635 3.725338 1.351635 6.647401C1.351843 9.569296 3.711911 11.938273 6.623219 11.938273C9.534361 11.938064 11.894637 9.569171 11.894845 6.647401ZM13.245462 6.647401C13.245254 10.317935 10.280401 13.293613 6.623219 13.293821C2.965871 13.293821 0.000204 10.31806 0 6.647401C0 2.976574 2.965746 0 6.623219 0C10.280526 0.000205 13.245462 2.9767 13.245462 6.647401Z" />
      <path fill="currentColor" d="M16.000417 15.041079L15.044449 16.000433L11.530434 12.473588L12.486298 11.514234L16.000417 15.041079Z" />
    </svg>
  )
}

// ── types ───────────────────────────────────────────────────────────────────

interface OverviewData {
  skills: Array<{ name: string; description: string }>
  mcp: Array<{ server: string; toolCount: number }>
  config: { mode?: string; skills?: string[]; mcps?: string[] }
}

interface ScopeDraft {
  skills: Set<string>
  mcps: Set<string>
}

interface DockProps {
  useSessions?: (sel: (s: any) => any) => any
}

// ── switch ──────────────────────────────────────────────────────────────────
// Self-drawn theme-aware switch. The harness ships no reusable Switch
// component (the only role="switch" usage, TrajectoryToolbar, is a hand-rolled
// track+thumb); this mirrors that pattern but keeps every color on dsh theme
// tokens so a theme switch re-skins it automatically.

function WscSwitch(props: { checked: boolean; onToggle: () => void; label: string }): React.ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      className="wsc-switch"
      onClick={props.onToggle}
    >
      <span className="wsc-switch-track" data-on={props.checked ? 'true' : undefined} aria-hidden="true">
        <span className="wsc-switch-thumb" />
      </span>
    </button>
  )
}

// ── entry (new-session screen only) ─────────────────────────────────────────

function ScopeBar(props: DockProps): React.ReactElement | null {
  const [open, setModalFn] = useModalOpen()
  // The scope shapes the startup context of a new conversation, so the entry
  // lives on the new-session screen only; ongoing conversations never show it
  // (their config is already locked in).
  const blank = props.useSessions !== undefined
    ? props.useSessions((s: any) => {
      if (!s.current) return undefined
      const row = s.byId[s.current]
      return row ? !!row.blank : undefined
    })
    : false
  if (blank !== true) return null
  // Compact chip inside the hero composer tool row.
  return (
    <button type="button" className="wsc-chip" onClick={() => setModalFn(!open)} aria-expanded={open} title="按工作区配置新对话启用的 Skill 与 MCP">
      <PresetIcon className="wsc-seat-icon" />
      <span>工作区能力</span>
      <ChevronIcon className="wsc-chevron" />
    </button>
  )
}

// ── modal ───────────────────────────────────────────────────────────────────

function ScopeModal(props: DockProps): React.ReactElement | null {
  const [open, setModalFn] = useModalOpen()
  const [data, setData] = React.useState<OverviewData | null>(null)
  const [draft, setDraft] = React.useState<ScopeDraft | null>(null)
  const [query, setQuery] = React.useState('')
  const [notice, setNotice] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState<string | null>(null)
  // Per-group collapse for the skill / MCP sections (heading arrow).
  const [collapsed, setCollapsed] = React.useState<{ skills: boolean; mcps: boolean }>({ skills: false, mcps: false })

  const sessionId = props.useSessions !== undefined
    ? props.useSessions((s: any) => s.current as string | undefined) as string | undefined
    : undefined

  // Latest session id, readable inside async continuations. The modal can
  // stay open while the user switches sessions; a response that arrives for
  // a superseded session must be dropped (stale-response race), otherwise a
  // later save() could write one workspace's config into another's.
  const sessionIdRef = React.useRef(sessionId)
  React.useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])

  const load = React.useCallback((): void => {
    if (!sessionId) return
    setError(null)
    // Capture the requested session; discard the response when the session
    // changed while the request was in flight.
    const requested = sessionId
    callHost('overview', { sessionId: requested })
      .then((value) => {
        if (requested !== sessionIdRef.current) return
        const v = value as OverviewData
        setData(v)
        // Present the enabled set for the saved mode; legacy/default configs
        // read as fully enabled (whitelist semantics is the single model).
        const cfg = v.config ?? {}
        const mode = cfg.mode ?? 'default'
        const allSkills = (v.skills ?? []).map((s) => s.name)
        const allMcps = (v.mcp ?? []).map((m) => m.server)
        const savedSkills = new Set(cfg.skills ?? [])
        const savedMcps = new Set(cfg.mcps ?? [])
        setDraft({
          skills: mode === 'whitelist'
            ? savedSkills
            : mode === 'blacklist'
              ? new Set(allSkills.filter((n) => !savedSkills.has(n)))
              : new Set(allSkills),
          mcps: mode === 'whitelist'
            ? savedMcps
            : mode === 'blacklist'
              ? new Set(allMcps.filter((n) => !savedMcps.has(n)))
              : new Set(allMcps),
        })
      })
      .catch((err: unknown) => {
        if (requested !== sessionIdRef.current) return
        setError(String((err && (err as Error).message) || err))
      })
  }, [sessionId])

  React.useEffect(() => {
    if (!open) return
    // Reopening must not leak the previous search term.
    setQuery('')
    load()
  }, [open, load])

  // Switching sessions while the modal is open must not show stale data.
  React.useEffect(() => {
    setData(null)
    setDraft(null)
    setNotice(null)
    setError(null)
    setExpanded(null)
    setCollapsed({ skills: false, mcps: false })
    setQuery('')
  }, [sessionId])

  // Esc closes the modal; Tab stays inside the dialog (focus trap).
  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setModalFn(false)
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = [...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      if (focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // ── autosave: every draft change persists immediately ─────────────────────
  // No debounce: the dynamic client sandbox has no timer globals, and a small
  // local JSON write per change is cheap. Rapid changes each issue their own
  // write; the last one wins on disk, and stale responses are dropped below.

  const autosave = React.useCallback((next: ScopeDraft): void => {
    if (sessionId === undefined) return
    setNotice(null)
    // Payload pins the session at change time; a response that arrives after
    // the user switched sessions must not post its notice into the new one.
    const requested = sessionId
    callHost('save', {
      sessionId: requested,
      mode: 'whitelist',
      skills: [...next.skills],
      mcps: [...next.mcps],
    })
      .then((r: { saved?: boolean; reason?: string }) => {
        if (requested !== sessionIdRef.current) return
        setNotice(r.saved === true
          ? { kind: 'ok', text: '已保存 ✓（生效于该工作区的新对话）' }
          : { kind: 'err', text: `保存失败：${r.reason ?? '未知'}` })
      })
      .catch((err: unknown) => {
        if (requested !== sessionIdRef.current) return
        setNotice({ kind: 'err', text: `保存失败：${String((err && (err as Error).message) || err)}` })
      })
  }, [sessionId])

  // Give keyboard focus to the dialog when it opens, so Tab starts inside
  // the panel instead of the page behind the mask.
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (open) panelRef.current?.focus()
  }, [open])

  if (!open) return null

  const skills = data?.skills ?? []
  const mcps = data?.mcp ?? []
  const selectedSkills = draft?.skills ?? new Set<string>()
  const selectedMcps = draft?.mcps ?? new Set<string>()

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleSkills = normalizedQuery === ''
    ? skills
    : skills.filter((s) => s.name.toLocaleLowerCase().includes(normalizedQuery) || s.description.toLocaleLowerCase().includes(normalizedQuery))
  const visibleMcps = normalizedQuery === ''
    ? mcps
    : mcps.filter((m) => m.server.toLocaleLowerCase().includes(normalizedQuery))

  const applyDraft = (next: ScopeDraft): void => {
    if (draft === null) return
    setDraft(next)
    autosave(next)
  }

  const toggleSkill = (name: string): void => {
    if (draft === null) return
    const s = new Set(draft.skills)
    if (s.has(name)) s.delete(name)
    else s.add(name)
    applyDraft({ ...draft, skills: s })
  }
  const toggleMcp = (server: string): void => {
    if (draft === null) return
    const s = new Set(draft.mcps)
    if (s.has(server)) s.delete(server)
    else s.add(server)
    applyDraft({ ...draft, mcps: s })
  }
  const allEnabled = (): void => {
    if (draft === null) return
    applyDraft({
      // Union with the saved set: never drop whitelist entries that are
      // outside the (possibly global) overview snapshot.
      ...draft,
      skills: new Set([...draft.skills, ...skills.map((s) => s.name)]),
      mcps: new Set([...draft.mcps, ...mcps.map((m) => m.server)]),
    })
  }
  const allDisabled = (): void => {
    if (draft === null) return
    applyDraft({ ...draft, skills: new Set<string>(), mcps: new Set<string>() })
  }

  // Rows filtered out by search collapse visually; clearing the query
  // restores their expanded state (no extra effect needed).
  const visibleIds = [
    ...visibleSkills.map((s) => `skill:${s.name}`),
    ...visibleMcps.map((m) => `mcp:${m.server}`),
  ]

  const renderRow = (
    id: string,
    name: string,
    detail: string,
    kind: 'skill' | 'mcp',
    enabled: boolean,
    onToggle: () => void,
  ): React.ReactElement => {
    const open = expanded === id && visibleIds.includes(id)
    return (
      <li className="wsc-card" data-open={open ? 'true' : undefined} key={id}>
        <div className="wsc-card-main">
          <WscSwitch
            checked={enabled}
            onToggle={onToggle}
            label={`${enabled ? '禁用' : '启用'} ${name}`}
          />
          <button
            type="button"
            className="wsc-row"
            aria-expanded={open}
            aria-controls={`wsc-details-${id}`}
            onClick={() => setExpanded(open ? null : id)}
          >
            <span className="wsc-card-title">{name}</span>
            <span className="wsc-tag" data-enabled={enabled ? 'true' : 'false'}>{enabled ? '已启用' : '已禁用'}</span>
            <ChevronIcon className="wsc-chevron" />
          </button>
        </div>
        {open ? (
          <div className="wsc-card-details" id={`wsc-details-${id}`}>
            <p className="wsc-detail-desc">{detail}</p>
            <dl className="wsc-details">
              <div>
                <dt>状态</dt>
                <dd>{enabled ? '已启用' : '已禁用'}</dd>
              </div>
              {kind === 'skill'
                ? (
                  <div>
                    <dt>加载</dt>
                    <dd>会话中可用 /{name} 临时加载</dd>
                  </div>
                )
                : (
                  <div>
                    <dt>类型</dt>
                    <dd>MCP 服务器</dd>
                  </div>
                )}
            </dl>
          </div>
        ) : null}
      </li>
    )
  }

  const body = data === null
    ? <div className="wsc-hint">{error ?? (sessionId !== undefined ? '正在加载…' : '当前没有可用的会话上下文，请先新建或打开一个会话。')}</div>
    : (
      <div className="wsc-body">
        <p className="wsc-desc">
          仅对新对话开场生效：本配置决定新对话开始时注入的技能与 MCP，已进行的对话不受影响。不影响 /&lt;技能名&gt; 手势：对话中随时可用。改动即时保存。
        </p>
        <label className="wsc-search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            placeholder="搜索技能或 MCP…"
            aria-label="搜索技能或 MCP"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="wsc-heading"
          data-collapsed={collapsed.skills ? 'true' : undefined}
          aria-expanded={!collapsed.skills}
          onClick={() => setCollapsed((c) => ({ ...c, skills: !c.skills }))}
        >
          <h3>技能</h3>
          <span data-count={visibleSkills.length}>{visibleSkills.length}</span>
          <ChevronIcon className="wsc-heading-chevron" />
        </button>
        {!collapsed.skills && (visibleSkills.length > 0
          ? (
            <ul className="wsc-cards">
              {visibleSkills.map((s) => renderRow(
                `skill:${s.name}`,
                s.name,
                s.description,
                'skill',
                selectedSkills.has(s.name),
                () => toggleSkill(s.name),
              ))}
            </ul>
          )
          : <p className="wsc-hint">没有匹配的技能。</p>)}
        <button
          type="button"
          className="wsc-heading"
          data-collapsed={collapsed.mcps ? 'true' : undefined}
          aria-expanded={!collapsed.mcps}
          onClick={() => setCollapsed((c) => ({ ...c, mcps: !c.mcps }))}
        >
          <h3>MCP 服务器</h3>
          <span data-count={visibleMcps.length}>{visibleMcps.length}</span>
          <ChevronIcon className="wsc-heading-chevron" />
        </button>
        {!collapsed.mcps && (visibleMcps.length > 0
          ? (
            <ul className="wsc-cards">
              {visibleMcps.map((m) => renderRow(
                `mcp:${m.server}`,
                m.server,
                `${m.toolCount} 个工具`,
                'mcp',
                selectedMcps.has(m.server),
                () => toggleMcp(m.server),
              ))}
            </ul>
          )
          : <p className="wsc-hint">没有匹配的 MCP 服务器。</p>)}
        <div className="wsc-actions">
          <button type="button" className="wsc-btn" onClick={allEnabled}>全部启用</button>
          <button type="button" className="wsc-btn" onClick={allDisabled}>全部禁用</button>
        </div>
        {notice !== null
          ? <p className={notice.kind === 'ok' ? 'wsc-notice' : 'wsc-error'}>{notice.text}</p>
          : null}
        {error !== null ? <p className="wsc-error">{error}</p> : null}
      </div>
    )

  return (
    <div className="wsc-overlay">
      <div className="wsc-mask" onClick={() => setModalFn(false)} />
      <div className="wsc-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="工作区能力">
        <div className="wsc-panel-head">
          <span className="wsc-panel-title">工作区能力</span>
          <button type="button" className="wsc-close" onClick={() => setModalFn(false)} title="关闭">
            <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
              <path fill="currentColor" d="M7 5.84863L4.57617 3.4248L3.4248 4.57617L5.84863 7L3.4248 9.42383L4.57617 10.5752L7 8.15137L9.42383 10.5752L10.5752 9.42383L8.15137 7L10.5752 4.57617L9.42383 3.4248L7 5.84863Z" />
            </svg>
          </button>
        </div>
        <div className="wsc-panel-body">{body}</div>
      </div>
    </div>
  )
}

// ── plugin ──────────────────────────────────────────────────────────────────

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'workspace-scope'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => { tag.remove() }
  })

  const slots = ctx.get('slots') as {
    inject(key: string, callback: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): unknown
  } | undefined
  if (slots === undefined) return

  // Entry: compact chip in the hero composer tool row (new-session screen).
  // The scope shapes startup context, so there is no seat in ongoing
  // conversations.
  slots.inject('conversation.input.right', () => slots.register(
    { name: 'conversation.input.right', id: 'workspace-scope', order: 30, label: () => '工作区能力' },
    (props: unknown) => React.createElement(ScopeBar, props as DockProps),
  ))
  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'workspace-scope-modal', order: 50 },
    (props: unknown) => React.createElement(ScopeModal, props as DockProps),
  ))
}
