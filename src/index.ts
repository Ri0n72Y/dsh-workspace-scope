/** dsh-workspace-scope — Host entry and composition root. */
import type { Context } from "@deepseek-ai/cordis";
import { createWorkspaceApi, registerHttpApi } from "./host/api.js";
import { createConfigStore, parseScopeConfig } from "./host/config.js";
import { deniedServers, deniedSkills } from "./host/policy.js";
import { registerRuntimePolicy } from "./host/runtime-policy.js";
import type {
  AgentsServiceLike,
  FsServiceLike,
  SkillsServiceLike,
  SystemPromptLike,
  ToolsServiceLike,
  WebServerLike,
} from "./host/types.js";

export { parseScopeConfig, deniedServers, deniedSkills };

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

  const configStore = createConfigStore(ctx, fs);
  registerRuntimePolicy(ctx, { configStore, skills, tools, systemPrompt });

  const api = createWorkspaceApi({ agents, skills, tools, configStore });
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
