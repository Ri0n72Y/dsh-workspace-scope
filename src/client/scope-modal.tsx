import React, { useEffect, useRef, useState } from "react";
import { CapabilityRow, SearchIcon, SectionHeading } from "./components.js";
import { setModalOpen, useModalOpen } from "./modal-state.js";
import { draftFromConfig, policyEnabled, setAllCapabilities, toggleCapability } from "./model.js";
import type { DockProps, OverviewData, ScopeDraft } from "./model.js";
import css from "./styles.module.css";
import { callHost } from "./transport.js";

export function ScopeModalSeat(props: DockProps) {
  const open = useModalOpen();
  return open ? <ScopeModal {...props} /> : null;
}

function ScopeModal(props: DockProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [draft, setDraft] = useState<ScopeDraft | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState({ skills: false, mcps: false });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<string | undefined>(undefined);

  const sessionId = props.useSessions?.((state: any) => state.current as string | undefined) as string | undefined;
  const agentPreset = props.useSessions?.((state: any) => {
    if (!state.current) return undefined;
    return state.byId[state.current]?.projectionValues?.agentPreset as string | undefined;
  }) as string | undefined;

  useEffect(() => {
    sessionRef.current = sessionId;
    setData(null);
    setDraft(null);
    setNotice(null);
    setError(null);
    setExpanded(null);
    setCollapsed({ skills: false, mcps: false });
    setQuery("");
    if (!sessionId) return;

    let current = true;
    callHost("overview", { sessionId })
      .then((value: unknown) => {
        if (!current) return;
        const overview = value as OverviewData;
        setData(overview);
        setDraft(draftFromConfig(overview.config));
      })
      .catch((loadError: unknown) => {
        if (current) setError(String((loadError && (loadError as Error).message) || loadError));
      });
    return () => {
      current = false;
    };
  }, [sessionId, agentPreset]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModalOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = [...panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )];
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
  }, []);

  const autosave = (next: ScopeDraft) => {
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
        if (requested !== sessionRef.current) return;
        setNotice(result.saved === true
          ? { kind: "ok", text: "已保存 ✓（生效于该工作区的新对话）" }
          : { kind: "err", text: `保存失败：${result.reason ?? "未知"}` });
      })
      .catch((saveError: unknown) => {
        if (requested !== sessionRef.current) return;
        setNotice({ kind: "err", text: `保存失败：${String((saveError && (saveError as Error).message) || saveError)}` });
      });
  };

  const skills = data?.skills ?? [];
  const mcps = data?.mcp ?? [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSkills = normalizedQuery === "" ? skills : skills.filter((skill) =>
    skill.name.toLocaleLowerCase().includes(normalizedQuery)
    || skill.description.toLocaleLowerCase().includes(normalizedQuery));
  const visibleMcps = normalizedQuery === "" ? mcps : mcps.filter((mcp) =>
    mcp.server.toLocaleLowerCase().includes(normalizedQuery));

  const applyDraft = (next: ScopeDraft) => {
    setDraft(next);
    autosave(next);
  };
  const toggle = (key: "skills" | "mcps", name: string) => {
    if (draft) applyDraft(toggleCapability(draft, key, name));
  };
  const setAll = (enabled: boolean) => {
    if (!draft) return;
    applyDraft(setAllCapabilities(
      draft,
      new Set(skills.map((skill) => skill.name)),
      new Set(mcps.map((mcp) => mcp.server)),
      enabled,
    ));
  };

  return (
    <div className={css.overlay}>
      <div className={css.mask} onClick={() => setModalOpen(false)} />
      <div className={css.panel} ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="工作区能力">
        <div className={css.panelHead}>
          <span className={css.panelTitle}>工作区能力</span>
          <button type="button" className={css.close} onClick={() => setModalOpen(false)} title="关闭">
            <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
              <path fill="currentColor" d="M7 5.84863L4.57617 3.4248L3.4248 4.57617L5.84863 7L3.4248 9.42383L4.57617 10.5752L7 8.15137L9.42383 10.5752L10.5752 9.42383L8.15137 7L10.5752 4.57617L9.42383 3.4248L7 5.84863Z" />
            </svg>
          </button>
        </div>
        <div className={css.panelBody}>
          {data === null ? (
            <div className={css.hint}>{error ?? (sessionId ? "正在加载…" : "当前没有可用的会话上下文，请先新建或打开一个会话。")}</div>
          ) : (
            <div className={css.body}>
              <p className={css.desc}>
                仅显示当前 Agent 已提供的技能，并对这些技能和 Host 全局 MCP 应用工作区策略。
                切换 Agent Preset 后技能列表会同步更新；改动即时保存，只影响该工作区之后开始的新对话。
              </p>
              <label className={css.search}>
                <SearchIcon />
                <input type="search" value={query} placeholder="搜索技能或全局 MCP…" aria-label="搜索技能或全局 MCP" onChange={(event) => setQuery(event.currentTarget.value)} />
              </label>

              <SectionHeading label="技能" count={visibleSkills.length} collapsed={collapsed.skills} onToggle={() => setCollapsed((value) => ({ ...value, skills: !value.skills }))} />
              {!collapsed.skills && (visibleSkills.length > 0 ? (
                <ul className={css.cards}>
                  {visibleSkills.map((skill) => {
                    const id = `skill:${skill.name}`;
                    return <CapabilityRow key={id} id={id} label={skill.name} detail={skill.description} kind="skill" enabled={draft !== null && policyEnabled(draft.mode, draft.skills, skill.name)} open={expanded === id} onToggle={() => toggle("skills", skill.name)} onExpand={() => setExpanded(expanded === id ? null : id)} />;
                  })}
                </ul>
              ) : <p className={css.hint}>没有匹配的技能。</p>)}

              <SectionHeading label="全局 MCP 服务器" count={visibleMcps.length} collapsed={collapsed.mcps} onToggle={() => setCollapsed((value) => ({ ...value, mcps: !value.mcps }))} />
              {!collapsed.mcps && (visibleMcps.length > 0 ? (
                <ul className={css.cards}>
                  {visibleMcps.map((mcp) => {
                    const id = `mcp:${mcp.server}`;
                    return <CapabilityRow key={id} id={id} label={mcp.server} detail={`${mcp.toolCount} 个工具`} kind="mcp" enabled={draft !== null && policyEnabled(draft.mode, draft.mcps, mcp.server)} open={expanded === id} onToggle={() => toggle("mcps", mcp.server)} onExpand={() => setExpanded(expanded === id ? null : id)} />;
                  })}
                </ul>
              ) : <p className={css.hint}>没有匹配的全局 MCP 服务器。</p>)}

              <div className={css.actions}>
                <button type="button" className={css.btn} onClick={() => setAll(true)}>全部启用</button>
                <button type="button" className={css.btn} onClick={() => setAll(false)}>全部禁用</button>
              </div>
              {notice && <p className={notice.kind === "ok" ? css.notice : css.error}>{notice.text}</p>}
              {error && <p className={css.error}>{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
