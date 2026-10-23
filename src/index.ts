/** dsh-workspace-scope — Host entry and composition root. */
import type { Context } from "@deepseek-ai/cordis";
import { createWorkspaceApi, registerHttpApi } from "./host/api.js";
import { createConfigStore, parseScopeConfig } from "./host/config.js";
import { deniedServers, deniedSkills } from "./host/policy.js";
import { registerRuntimePolicy } from "./host/runtime-policy.js";
import {
  createScopeResolver,
  effectiveCwdOf,
  isPathWithin,
  scopeSearchDirs,
} from "./host/scope-location.js";
import type {
  AgentsServiceLike,
  FsServiceLike,
  SessionLike,
  SkillsServiceLike,
  SkillAccess,
  SystemPromptLike,
  ToolsServiceLike,
  WebServerLike,
  WorkingDirectoryLike,
} from "./host/types.js";

export {
  parseScopeConfig,
  deniedServers,
  deniedSkills,
  createScopeResolver,
  effectiveCwdOf,
  isPathWithin,
  scopeSearchDirs,
};

declare const harness: any;

export const name = "dsh-workspace-scope";
export const inject = ["webServer", "fs", "skills", "tools", "agents", "systemPrompt"];

export function apply(ctx: Context): void {
  const webServer = ctx.get("webServer") as WebServerLike;
  const fs = ctx.get("fs") as FsServiceLike;
  const skills = ctx.get("skills") as SkillsServiceLike;
  const tools = ctx.get("tools") as ToolsServiceLike;
  const agents = ctx.get("agents") as AgentsServiceLike;
  const systemPrompt = ctx.get("systemPrompt") as SystemPromptLike;

  // Looked up softly on every call instead of injected: Cordis treats every
  // inject entry as required, and the plugin must keep starting on DSH builds
  // without this service (it then reads the header cwd, as before).
  const getWorkingDirectory = () =>
    ctx.get("workingDirectory") as WorkingDirectoryLike | undefined;
  const effectiveCwd = (session: SessionLike | undefined) =>
    effectiveCwdOf(getWorkingDirectory, session);
  const configStore = createConfigStore(ctx, fs, createScopeResolver(fs, getWorkingDirectory));

  // SkillRegistry uses one service-wide revision. Keep this plugin's own
  // dispose/snapshot/register/verify transactions from invalidating each other
  // when sibling Agents enter pre-step concurrently. The queue is per plugin
  // instance and never serializes downstream Agent work.
  let skillTail = Promise.resolve();
  const skillAccess: SkillAccess = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = skillTail;
    let release!: () => void;
    skillTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  registerRuntimePolicy(ctx, {
    configStore,
    skills,
    tools,
    systemPrompt,
    skillAccess,
    effectiveCwd,
  });

  const api = createWorkspaceApi({ agents, skills, tools, configStore, skillAccess, effectiveCwd });
  registerHttpApi(ctx, webServer, api);

  if (typeof harness !== "undefined") {
    harness.handle("overview", async (args: { sessionId?: unknown }) =>
      api.overview(typeof args?.sessionId === "string" ? args.sessionId : ""),
    );
    harness.handle("save", async (args: unknown) => {
      try {
        return await api.save((args ?? {}) as Record<string, unknown>);
      } catch (error) {
        return { error: String((error && (error as Error).message) || error) };
      }
    });
  }
}
