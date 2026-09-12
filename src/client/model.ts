export interface OverviewData {
  skills: Array<{ name: string; description: string }>;
  mcp: Array<{ server: string; toolCount: number }>;
  config: { mode?: string; skills?: string[]; mcps?: string[] };
}

export type ScopeMode = "default" | "whitelist" | "blacklist";

export interface ScopeDraft {
  mode: ScopeMode;
  skills: Set<string>;
  mcps: Set<string>;
}

export interface DockProps {
  useSessions?: (selector: (state: any) => any) => any;
}

export function draftFromConfig(config: OverviewData["config"] | undefined): ScopeDraft {
  const value = config ?? {};
  const mode: ScopeMode =
    value.mode === "whitelist" || value.mode === "blacklist"
      ? value.mode
      : "default";
  return {
    mode,
    skills: new Set(value.skills ?? []),
    mcps: new Set(value.mcps ?? []),
  };
}

export function policyEnabled(mode: ScopeMode, listed: Set<string>, name: string): boolean {
  if (mode === "default") return true;
  return mode === "whitelist" ? listed.has(name) : !listed.has(name);
}

export function toggleCapability(
  draft: ScopeDraft,
  key: "skills" | "mcps",
  name: string,
): ScopeDraft {
  if (draft.mode === "default") {
    return {
      mode: "blacklist",
      skills: new Set(key === "skills" ? [name] : []),
      mcps: new Set(key === "mcps" ? [name] : []),
    };
  }
  const listed = new Set(draft[key]);
  if (listed.has(name)) listed.delete(name);
  else listed.add(name);
  return { ...draft, [key]: listed };
}

export function setAllCapabilities(
  draft: ScopeDraft,
  currentSkills: Set<string>,
  currentMcps: Set<string>,
  enabled: boolean,
): ScopeDraft {
  if (draft.mode === "default") {
    if (enabled) return draft;
    return { mode: "blacklist", skills: currentSkills, mcps: currentMcps };
  }

  const update = (listed: Set<string>, current: Set<string>): Set<string> => {
    if (draft.mode === "whitelist") {
      return enabled
        ? new Set([...listed, ...current])
        : new Set([...listed].filter((name) => !current.has(name)));
    }
    return enabled
      ? new Set([...listed].filter((name) => !current.has(name)))
      : new Set([...listed, ...current]);
  };

  return {
    ...draft,
    skills: update(draft.skills, currentSkills),
    mcps: update(draft.mcps, currentMcps),
  };
}
