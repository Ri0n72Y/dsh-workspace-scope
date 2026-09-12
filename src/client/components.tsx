import React, { useId } from "react";
import type { DockProps } from "./model.js";
import { setModalOpen, useModalOpen } from "./modal-state.js";
import css from "./styles.module.css";

export function PresetIcon(props: { className?: string }) {
  const maskId = `wsc${useId().replaceAll(":", "")}`;
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
  );
}

export function ChevronIcon(props: { className?: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" className={props.className}>
      <path fill="currentColor" d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path fill="currentColor" d="M11.894845 6.647401C11.894845 3.725463 9.534486 1.356779 6.623219 1.35657C3.711786 1.35657 1.351635 3.725338 1.351635 6.647401C1.351843 9.569296 3.711911 11.938273 6.623219 11.938273C9.534361 11.938064 11.894637 9.569171 11.894845 6.647401ZM13.245462 6.647401C13.245254 10.317935 10.280401 13.293613 6.623219 13.293821C2.965871 13.293821 0.000204 10.31806 0 6.647401C0 2.976574 2.965746 0 6.623219 0C10.280526 0.000205 13.245462 2.9767 13.245462 6.647401Z" />
      <path fill="currentColor" d="M16.000417 15.041079L15.044449 16.000433L11.530434 12.473588L12.486298 11.514234L16.000417 15.041079Z" />
    </svg>
  );
}

export function WscSwitch(props: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={props.checked} aria-label={props.label} className={css.switch} onClick={props.onToggle}>
      <span className={css.switchTrack} data-on={props.checked ? "true" : undefined} aria-hidden="true">
        <span className={css.switchThumb} />
      </span>
    </button>
  );
}

export function ScopeBar(props: DockProps) {
  const open = useModalOpen();
  const blank = props.useSessions !== undefined
    ? props.useSessions((state: any) => {
        if (!state.current) return undefined;
        const row = state.byId[state.current];
        return row ? !!row.blank : undefined;
      })
    : false;
  if (blank !== true) return null;
  return (
    <button type="button" className={css.chip} onClick={() => setModalOpen(!open)} aria-expanded={open} title="按工作区限制当前 Agent 的 Skill 与 Host 全局 MCP">
      <PresetIcon className={css.seatIcon} />
      <span>工作区能力</span>
      <ChevronIcon className={css.chevron} />
    </button>
  );
}

export function SectionHeading(props: { label: string; count: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={css.heading} data-collapsed={props.collapsed ? "true" : undefined} aria-expanded={!props.collapsed} onClick={props.onToggle}>
      <h3>{props.label}</h3>
      <span data-count={props.count}>{props.count}</span>
      <ChevronIcon className={css.headingChevron} />
    </button>
  );
}

export function CapabilityRow(props: {
  id: string;
  label: string;
  detail: string;
  kind: "skill" | "mcp";
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
  onExpand: () => void;
}) {
  return (
    <li className={css.card} data-open={props.open ? "true" : undefined}>
      <div className={css.cardMain}>
        <WscSwitch checked={props.enabled} onToggle={props.onToggle} label={`${props.enabled ? "禁用" : "启用"} ${props.label}`} />
        <button type="button" className={css.row} aria-expanded={props.open} aria-controls={`wsc-details-${props.id}`} onClick={props.onExpand}>
          <span className={css.cardTitle}>{props.label}</span>
          <span className={css.tag} data-enabled={props.enabled ? "true" : "false"}>{props.enabled ? "已启用" : "已禁用"}</span>
          <ChevronIcon className={css.chevron} />
        </button>
      </div>
      {props.open && (
        <div className={css.cardDetails} id={`wsc-details-${props.id}`}>
          <p className={css.detailDesc}>{props.detail}</p>
          <dl className={css.details}>
            <div><dt>状态</dt><dd>{props.enabled ? "已启用" : "已禁用"}</dd></div>
            {props.kind === "mcp" && <div><dt>类型</dt><dd>Host 全局 MCP 服务器</dd></div>}
          </dl>
        </div>
      )}
    </li>
  );
}
