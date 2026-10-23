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

export type SkillAccess = <T>(operation: () => Promise<T>) => Promise<T>;

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

export interface FsPathInfoLike {
  type: "file" | "directory" | "symlink" | "other";
}

export interface FsServiceLike {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>;
  /** Canonical absolute path of a resolved target. */
  processPath(target: unknown): string;
  /** Canonical containment of two resolved targets. */
  contains(parent: unknown, child: unknown): boolean;
  /** Path metadata without following a final symbolic link; undefined when absent. */
  lstat(
    path: string,
    opts?: { cwd?: string },
    signal?: AbortSignal,
  ): Promise<FsPathInfoLike | undefined>;
  readText(target: unknown, signal?: AbortSignal): Promise<string>;
  writeText(
    target: unknown,
    content: string,
    expected?: unknown,
    signal?: unknown,
    sandboxPolicy?: unknown,
  ): Promise<unknown>;
}

/** The DSH `workingDirectory` service: the Session's effective directory. */
export interface WorkingDirectoryLike {
  get(session: SessionLike): string;
}

/** Where a Session's scope file is, or would be created. */
export interface ScopeLocation {
  /** Absolute path of the scope file; undefined when no workspace is known. */
  path?: string;
  /** Resolved fs target of `path`. */
  target?: unknown;
  /** Whether an existing scope file was found. */
  exists: boolean;
  /** Whether `save` may write to `path`. */
  writable: boolean;
}

export interface ConfigStore {
  read(session: SessionLike | undefined, signal?: AbortSignal): Promise<ScopeConfig>;
  write(
    session: SessionLike | undefined,
    config: ScopeConfig,
  ): Promise<{ saved: boolean; reason?: string }>;
}
