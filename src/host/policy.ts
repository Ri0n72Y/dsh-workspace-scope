import type { ScopeConfig, ScopeMode } from "./types";

function excludedNames(mode: ScopeMode, selected: string[], all: string[]): string[] {
  if (mode === "default") return [];
  const set = new Set(selected);
  return mode === "whitelist"
    ? all.filter((name) => !set.has(name))
    : all.filter((name) => set.has(name));
}

export function deniedServers(config: ScopeConfig, allServers: string[]): string[] {
  return excludedNames(config.mode, config.mcps, allServers);
}

export function deniedSkills(config: ScopeConfig, allSkills: string[]): string[] {
  return excludedNames(config.mode, config.skills, allSkills);
}
