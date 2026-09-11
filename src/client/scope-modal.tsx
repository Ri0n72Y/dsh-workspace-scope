import React from "react";
import { ChevronIcon, SearchIcon, WscSwitch } from "./components.js";
import { useModalOpen } from "./modal-state.js";
import { draftFromConfig, policyEnabled, setAllCapabilities, toggleCapability } from "./model.js";
import type { DockProps, OverviewData, ScopeDraft } from "./model.js";
import { callHost } from "./transport.js";

export function ScopeModal(props: DockProps): React.ReactElement | null {
  const [open, setModal] = useModalOpen();
  const [data, setData] = React.useState<OverviewData | null>(null);
  const [draft, setDraft] = React.useState<ScopeDraft | null>(null);
  const [query, setQuery] = React.useState("");
  const [notice, setNotice] = React.useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState({ skills: false, mcps: false });
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  const sessionId = props.useSessions !== undefined
    ? (props.useSessions((state: any) => state.current as string | undefined) as string | undefined)
    : undefined;
  const agentPreset = props.useSessions !== undefined
    ? (props.useSessions((state: any) => {
        if (!state.current) return undefined;
        return state.byId[state.current]?.projectionValues?.agentPreset as string | undefined;
      }) as string | undefined)
    : undefined;
  const viewKey = `${sessionId ?? ""}\n${agentPreset ?? ""}`;

  const viewKeyRef = React.useRef(viewKey);
  const sessionIdRef = React.useRef(sessionId);
  React.useEffect(() => {
    viewKeyRef.current = viewKey;
    sessionIdRef.current = sessionId;
  }, [viewKey, sessionId]);

  const load = React.useCallback((): void => {
    if (!sessionId) return;
    setError(null);
    const requestedSession = sessionId;
    const requestedView = viewKey;
    callHost("overview", { sessionId: requestedSession })
      .then((value: unknown) => {
        if (requestedView !== viewKeyRef.current) return;
        const overview = value as OverviewData;
        setData(overview);
        setDraft(draftFromConfig(overview.config));
      })
      .catch((loadError: unknown) => {
        if (requestedView !== viewKeyRef.current) return;
        setError(String((loadError && (loadError as Error).message) || loadError));
      });
  }, [sessionId, viewKey]);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    load();
  }, [open, load]);

  React.useEffect(() => {
    setData(null);
    setDraft(null);
    setNotice(null);
    setError(null);
    setExpanded(null);
    setCollapsed({ skills: false, mcps: false });
    setQuery("");
  }, [sessionId, agentPreset]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setModal(false);
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  React.useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const autosave = React.useCallback((next: ScopeDraft): void => {
    if (sessionId === undefined) return;
    setNotice(null);
    const requested = sessionId;
    callHost("save", {
      sessionId: requested,
      mode: next.mode,
      skills: [...next.skills],
      mcps: [...next.mcps],
    })
      .then((result: { saved?: boolean; reason?: string }) => {
        if (requested !== sessionIdRef.current) return;
        setNotice(
          result.saved === true
            ? { kind: "ok", text: "已保存 ✓（生效于该工作区的新对话）" }
            : { kind: "err", text: `保存失败：${result.reason ?? "未知"}` },
        );
      })
      .catch((saveError: unknown) => {
        if (requested !== sessionIdRef.current) return;
        setNotice({
          kind: "err",
          text: `保存失败：${String((saveError && (saveError as Error).message) || saveError)}`,
        });
      });
  }, [sessionId]);

  if (!open) return null;

  const skills = data?.skills ?? [];
  const mcps = data?.mcp ?? [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSkills = normalizedQuery === ""
    ? skills
    : skills.filter((skill) =>
        skill.name.toLocaleLowerCase().includes(normalizedQuery)
        || skill.description.toLocaleLowerCase().includes(normalizedQuery));
  const visibleMcps = normalizedQuery === ""
    ? mcps
    : mcps.filter((mcp) => mcp.server.toLocaleLowerCase().includes(normalizedQuery));
  const visibleIds = [
    ...visibleSkills.map((skill) => `skill:${skill.name}`),
    ...visibleMcps.map((mcp) => `mcp:${mcp.server}`),
  ];

  const applyDraft = (next: ScopeDraft): void => {
    if (draft === null) return;
    setDraft(next);
    autosave(next);
  };

  const toggle = (key: "skills" | "mcps", name: string): void => {
    if (draft === null) return;
    applyDraft(toggleCapability(draft, key, name));
  };

  const setAll = (enabled: boolean): void => {
    if (draft === null) return;
    applyDraft(setAllCapabilities(
      draft,
      new Set(skills.map((skill) => skill.name)),
      new Set(mcps.map((mcp) => mcp.server)),
      enabled,
    ));
  };

  const renderRow = (
    id: string,
    label: string,
    detail: string,
    kind: "skill" | "mcp",
    enabled: boolean,
    onToggle: () => void,
  ): React.ReactElement => {
    const rowOpen = expanded === id && visibleIds.includes(id);
    return (
      <li className="wsc-card" data-open={rowOpen ? "true" : undefined} key={id}>
        <div className="wsc-card-main">
          <WscSwitch checked={enabled} onToggle={onToggle} label={`${enabled ? "禁用" : "启用"} ${label}`} />
          <button type="button" className="wsc-row" aria-expanded={rowOpen} aria-controls={`wsc-details-${id}`} onClick={() => setExpanded(rowOpen ? null : id)}>
            <span className="wsc-card-title">{label}</span>
            <span className="wsc-tag" data-enabled={enabled ? "true" : "false"}>{enabled ? "已启用" : "已禁用"}</span>
            <ChevronIcon className="wsc-chevron" />
          </button>
        </div>
        {rowOpen ? (
          <div className="wsc-card-details" id={`wsc-details-${id}`}>
            <p className="wsc-detail-desc">{detail}</p>
            <dl className="wsc-details">
              <div><dt>状态</dt><dd>{enabled ? "已启用" : "已禁用"}</dd></div>
              {kind === "mcp" ? <div><dt>类型</dt><dd>Host 全局 MCP 服务器</dd></div> : null}
            </dl>
          </div>
        ) : null}
      </li>
    );
  };

  const body = data === null ? (
    <div className="wsc-hint">
      {error ?? (sessionId !== undefined ? "正在加载…" : "当前没有可用的会话上下文，请先新建或打开一个会话。")}
    </div>
  ) : (
    <div className="wsc-body">
      <p className="wsc-desc">
        仅显示当前 Agent 已提供的技能，并对这些技能和 Host 全局 MCP 应用工作区策略。
        切换 Agent Preset 后技能列表会同步更新；改动即时保存，只影响该工作区之后开始的新对话。
      </p>
      <label className="wsc-search">
        <SearchIcon />
        <input type="search" value={query} placeholder="搜索技能或全局 MCP…" aria-label="搜索技能或全局 MCP" onChange={(event) => setQuery(event.currentTarget.value)} />
      </label>

      <button type="button" className="wsc-heading" data-collapsed={collapsed.skills ? "true" : undefined} aria-expanded={!collapsed.skills} onClick={() => setCollapsed((value) => ({ ...value, skills: !value.skills }))}>
        <h3>技能</h3><span data-count={visibleSkills.length}>{visibleSkills.length}</span><ChevronIcon className="wsc-heading-chevron" />
      </button>
      {!collapsed.skills && (visibleSkills.length > 0 ? (
        <ul className="wsc-cards">
          {visibleSkills.map((skill) => renderRow(
            `skill:${skill.name}`,
            skill.name,
            skill.description,
            "skill",
            draft !== null && policyEnabled(draft.mode, draft.skills, skill.name),
            () => toggle("skills", skill.name),
          ))}
        </ul>
      ) : <p className="wsc-hint">没有匹配的技能。</p>)}

      <button type="button" className="wsc-heading" data-collapsed={collapsed.mcps ? "true" : undefined} aria-expanded={!collapsed.mcps} onClick={() => setCollapsed((value) => ({ ...value, mcps: !value.mcps }))}>
        <h3>全局 MCP 服务器</h3><span data-count={visibleMcps.length}>{visibleMcps.length}</span><ChevronIcon className="wsc-heading-chevron" />
      </button>
      {!collapsed.mcps && (visibleMcps.length > 0 ? (
        <ul className="wsc-cards">
          {visibleMcps.map((mcp) => renderRow(
            `mcp:${mcp.server}`,
            mcp.server,
            `${mcp.toolCount} 个工具`,
            "mcp",
            draft !== null && policyEnabled(draft.mode, draft.mcps, mcp.server),
            () => toggle("mcps", mcp.server),
          ))}
        </ul>
      ) : <p className="wsc-hint">没有匹配的全局 MCP 服务器。</p>)}

      <div className="wsc-actions">
        <button type="button" className="wsc-btn" onClick={() => setAll(true)}>全部启用</button>
        <button type="button" className="wsc-btn" onClick={() => setAll(false)}>全部禁用</button>
      </div>
      {notice !== null ? <p className={notice.kind === "ok" ? "wsc-notice" : "wsc-error"}>{notice.text}</p> : null}
      {error !== null ? <p className="wsc-error">{error}</p> : null}
    </div>
  );

  return (
    <div className="wsc-overlay">
      <div className="wsc-mask" onClick={() => setModal(false)} />
      <div className="wsc-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="工作区能力">
        <div className="wsc-panel-head">
          <span className="wsc-panel-title">工作区能力</span>
          <button type="button" className="wsc-close" onClick={() => setModal(false)} title="关闭">
            <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
              <path fill="currentColor" d="M7 5.84863L4.57617 3.4248L3.4248 4.57617L5.84863 7L3.4248 9.42383L4.57617 10.5752L7 8.15137L9.42383 10.5752L10.5752 9.42383L8.15137 7L10.5752 4.57617L9.42383 3.4248L7 5.84863Z" />
            </svg>
          </button>
        </div>
        <div className="wsc-panel-body">{body}</div>
      </div>
    </div>
  );
}
