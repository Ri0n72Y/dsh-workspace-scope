import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";

export type ScopeMode = "default" | "whitelist" | "blacklist";

export interface ScopeConfig {
  mode: ScopeMode;
  skills: string[];
  mcps: string[];
}

export interface Route {
  kind: "exact" | "prefix";
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

export interface WebServerLike {
  register(route: Route): () => void;
}

export interface SessionLike {
  header: { cwd: string };
}

export interface SkillInvocationLike {
  modelInvocable?: boolean;
  userInvocable?: boolean;
}

export interface SkillSummaryLike {
  name: string;
  description?: string;
  invocation?: SkillInvocationLike;
}

export interface SkillDefinitionLike extends SkillSummaryLike {
  content: string;
  [key: string]: unknown;
}

export interface SkillsServiceLike {
  snapshot(options: unknown): Promise<{ skills: SkillSummaryLike[]; complete: boolean }>;
  get(name: string, options: unknown): Promise<SkillDefinitionLike | undefined>;
}

export interface ScopedSkillsLike {
  register(skill: SkillDefinitionLike): () => void;
}

export interface ScopedToolsLike {
  restrict(filter: { deny: string[] }): () => void;
}

export interface AgentLike {
  id: string;
  session: SessionLike;
  ctx: Context;
}

export interface AgentsServiceLike {
  get(id: string): AgentLike | undefined;
}

export interface ToolsServiceLike {
  get(name: string, scope?: unknown): unknown;
  schemas(scope?: unknown): { name: string }[];
}

export interface PromptAssemblyLike {
  [key: string]: unknown;
}

export interface AssembleContextLike {
  agent?: AgentLike;
  signal?: AbortSignal;
  [key: string]: unknown;
}

export interface SystemPromptLike {
  assemble(context?: AssembleContextLike): Promise<PromptAssemblyLike>;
}

export interface SandboxPolicyServiceLike {
  resolve(request: { session: SessionLike; mode: "workspace-write" }): unknown;
}

export interface FsServiceLike {
  resolve(path: string): Promise<unknown>;
  readText(target: unknown): Promise<string>;
  writeText(
    target: unknown,
    content: string,
    expected?: unknown,
    signal?: unknown,
    sandboxPolicy?: unknown,
  ): Promise<unknown>;
}

export interface ConfigStore {
  read(cwd: string | undefined): Promise<ScopeConfig>;
  write(
    cwd: string | undefined,
    config: ScopeConfig,
    session: SessionLike | undefined,
  ): Promise<{ saved: boolean; reason?: string }>;
}
