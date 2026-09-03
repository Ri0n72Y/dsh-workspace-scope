/**
 * dsh-workspace-scope — Host half.
 *
 * Workspace config is locked when an Agent session starts. Host-global MCP
 * restrictions are installed before the first prompt assembly; Skill shadows
 * are refreshed at pre-step, immediately before DSH's skill catalog listener.
 */

import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";

declare const harness: any;

export const name = "dsh-workspace-scope";
export const inject = ["webServer", "fs", "skills", "tools", "agents"];

const CONFIG_FILE = ".dsh-scope.json";
const ROUTE_PREFIX = "/api/dsh-workspace-scope";
const MAX_BODY_BYTES = 65536;

type ScopeMode = "default" | "whitelist" | "blacklist";

interface ScopeConfig {
  mode: ScopeMode;
  skills: string[];
  mcps: string[];
}

const DEFAULT_CONFIG: ScopeConfig = { mode: "default", skills: [], mcps: [] };

export function parseScopeConfig(text: string | undefined): ScopeConfig {
  if (text === undefined || text === "") return { ...DEFAULT_CONFIG };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  const row =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { default?: unknown }).default
      : undefined;
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return { ...DEFAULT_CONFIG };
  }
  const r = row as { mode?: unknown; skills?: unknown; mcps?: unknown };
  return {
    mode: r.mode === "whitelist" || r.mode === "blacklist" ? r.mode : "default",
    skills: Array.isArray(r.skills)
      ? r.skills.filter((x): x is string => typeof x === "string")
      : [],
    mcps: Array.isArray(r.mcps)
      ? r.mcps.filter((x): x is string => typeof x === "string")
      : [],
  };
}

interface Route {
  kind: "exact" | "prefix";
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

interface WebServerLike {
  register(route: Route): () => void;
}

interface SessionLike {
  header: { cwd: string };
}

interface SkillInvocationLike {
  modelInvocable?: boolean;
  userInvocable?: boolean;
}

interface SkillSummaryLike {
  name: string;
  description?: string;
  invocation?: SkillInvocationLike;
}

interface SkillDefinitionLike extends SkillSummaryLike {
  content: string;
  [key: string]: unknown;
}

interface SkillsServiceLike {
  snapshot(options: unknown): Promise<{ skills: SkillSummaryLike[]; complete: boolean }>;
  get(name: string, options: unknown): Promise<SkillDefinitionLike | undefined>;
}

interface ScopedSkillsLike {
  register(skill: SkillDefinitionLike): () => void;
}

interface ScopedToolsLike {
  restrict(filter: { deny: string[] }): () => void;
}

interface AgentLike {
  id: string;
  status: "idle" | "running";
  session: SessionLike;
  ctx: {
    skills: ScopedSkillsLike;
    tools: ScopedToolsLike;
  };
  runMaintenance<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T>;
  whenIdle(): Promise<void>;
}

interface AgentsServiceLike {
  get(id: string): AgentLike | undefined;
  list(): AgentLike[];
}

interface ToolsServiceLike {
  schemas(scope?: unknown): { name: string }[];
}

interface SandboxPolicyServiceLike {
  resolve(request: { session: SessionLike; mode: "workspace-write" }): unknown;
}

interface FsServiceLike {
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

function excludedNames(mode: ScopeMode, selected: string[], all: string[]): string[] {
  if (mode === "default") return [];
  const set = new Set(selected);
  return mode === "whitelist"
    ? all.filter((name) => !set.has(name))
    : all.filter((name) => set.has(name));
}

export function deniedServers(cfg: ScopeConfig, allServers: string[]): string[] {
  return excludedNames(cfg.mode, cfg.mcps, allServers);
}

export function deniedSkills(cfg: ScopeConfig, allSkills: string[]): string[] {
  return excludedNames(cfg.mode, cfg.skills, allSkills);
}

export function apply(ctx: Context): void {
  const webServer = ctx.get("webServer") as WebServerLike;
  const fs = ctx.get("fs") as FsServiceLike;
  const skills = ctx.get("skills") as SkillsServiceLike;
  const tools = ctx.get("tools") as ToolsServiceLike;
  const agents = ctx.get("agents") as AgentsServiceLike;

  async function readConfig(cwd: string | undefined): Promise<ScopeConfig> {
    if (cwd === undefined || cwd === "") return { ...DEFAULT_CONFIG };
    try {
      const target = await fs.resolve(`${cwd}/${CONFIG_FILE}`);
      return parseScopeConfig(await fs.readText(target));
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  // ponytail: one queue is enough; split per cwd only if config-write throughput matters.
  let configWriteQueue: Promise<void> = Promise.resolve();

  function writeConfig(
    cwd: string | undefined,
    cfg: ScopeConfig,
    session: SessionLike | undefined,
  ): Promise<{ saved: boolean; reason?: string }> {
    const write = configWriteQueue.then(async () => {
      if (cwd === undefined || cwd === "") {
        return { saved: false, reason: "无法确定工作目录，未保存" };
      }
      try {
        const target = await fs.resolve(`${cwd}/${CONFIG_FILE}`);
        let all: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(await fs.readText(target)) as unknown;
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            all = parsed as Record<string, unknown>;
          }
        } catch {
          // Missing or invalid file: write a fresh document.
        }
        all.default = cfg;
        const sandboxPolicy = ctx.get("sandboxPolicy") as SandboxPolicyServiceLike | undefined;
        const policy =
          sandboxPolicy !== undefined && session !== undefined
            ? sandboxPolicy.resolve({ session, mode: "workspace-write" })
            : undefined;
        await fs.writeText(
          target,
          JSON.stringify(all, null, 2),
          undefined,
          undefined,
          policy,
        );
        return { saved: true };
      } catch (err) {
        return {
          saved: false,
          reason: String((err && (err as Error).message) || err),
        };
      }
    });
    configWriteQueue = write.then(() => undefined);
    return write;
  }

  function resolveAgent(sessionId: string): AgentLike | undefined {
    return sessionId === "" ? undefined : agents.get(sessionId);
  }

  function globalMcpToolsMap(): Map<string, string[]> {
    const byServer = new Map<string, string[]>();
    // DSH 0.1.2-rc.1 validates MCP server names as [A-Za-z0-9_-]{1,32}
    // and publishes every Host-global MCP tool as mcp__<server>__<tool>.
    for (const schema of tools.schemas()) {
      const match = /^mcp__([A-Za-z0-9_-]{1,32})__(.+)$/.exec(schema.name);
      if (match === null) continue;
      const server = match[1]!;
      const names = byServer.get(server) ?? [];
      if (!byServer.has(server)) byServer.set(server, names);
      names.push(schema.name);
    }
    return byServer;
  }

  function mcpInventoryKey(byServer: Map<string, string[]>): string {
    return JSON.stringify([...byServer.values()].flat().sort());
  }

  function disposeAll(disposers: Array<() => void>): void {
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
        // Agent scope teardown may already have removed the registration.
      }
    }
  }

  function safeDispose(dispose: (() => void) | undefined): void {
    if (dispose === undefined) return;
    try {
      dispose();
    } catch {
      // Agent scope teardown may already have removed the registration.
    }
  }

  async function installSkillPolicy(
    agent: AgentLike,
    cfg: ScopeConfig,
    signal: AbortSignal,
  ): Promise<(() => void) | undefined> {
    if (cfg.mode === "default") return undefined;
    const view = { scope: agent, cwd: agent.session.header.cwd, signal };
    const snapshot = await skills.snapshot(view);
    signal.throwIfAborted();
    if (!snapshot.complete) {
      throw new Error("dsh-workspace-scope: skill catalog is incomplete");
    }

    const denied = new Set(deniedSkills(cfg, snapshot.skills.map((skill) => skill.name)));
    if (denied.size === 0) return undefined;

    const disposers: Array<() => void> = [];
    try {
      for (const summary of snapshot.skills) {
        if (!denied.has(summary.name) || summary.invocation?.modelInvocable === false) continue;
        const definition = await skills.get(summary.name, view);
        signal.throwIfAborted();
        if (definition === undefined || definition.invocation?.modelInvocable === false) continue;
        disposers.push(
          agent.ctx.skills.register({
            ...definition,
            invocation: {
              ...definition.invocation,
              modelInvocable: false,
              userInvocable: definition.invocation?.userInvocable !== false,
            },
          }),
        );
      }
      return disposers.length === 0 ? undefined : () => disposeAll(disposers);
    } catch (err) {
      disposeAll(disposers);
      throw err;
    }
  }

  function installMcpPolicy(
    agent: AgentLike,
    cfg: ScopeConfig,
    byServer: Map<string, string[]> = globalMcpToolsMap(),
  ): (() => void) | undefined {
    if (cfg.mode === "default") return undefined;
    const denied = deniedServers(cfg, [...byServer.keys()]).flatMap(
      (server) => byServer.get(server) ?? [],
    );
    return denied.length === 0 ? undefined : agent.ctx.tools.restrict({ deny: denied });
  }

  interface ActivePolicy {
    agent: AgentLike;
    config: ScopeConfig;
    skillDispose?: () => void;
    mcpDispose?: () => void;
  }

  const activePolicies = new Map<string, ActivePolicy>();
  let globalMcpKey = mcpInventoryKey(globalMcpToolsMap());

  const onEvent = ctx.on as unknown as (
    name: string,
    listener: (...args: never[]) => unknown,
    options?: boolean | { prepend?: boolean },
  ) => unknown;

  async function initializeAgent(agent: AgentLike, signal: AbortSignal): Promise<void> {
    const cfg = await readConfig(agent.session.header.cwd);
    signal.throwIfAborted();
    const mcpDispose = installMcpPolicy(agent, cfg);
    const previous = activePolicies.get(agent.id);
    safeDispose(previous?.skillDispose);
    safeDispose(previous?.mcpDispose);
    activePolicies.set(agent.id, { agent, config: cfg, mcpDispose });
  }

  function startAgentPolicy(agent: AgentLike): Promise<void> {
    return agent.runMaintenance((signal) => initializeAgent(agent, signal));
  }

  ctx.effect(() => () => {
    for (const policy of activePolicies.values()) {
      safeDispose(policy.skillDispose);
      safeDispose(policy.mcpDispose);
    }
    activePolicies.clear();
  });

  onEvent("agent/session-start", ({ agent }: { agent: AgentLike }) => startAgentPolicy(agent));

  onEvent("agent/disposed", ({ agent }: { agent: AgentLike }) => {
    const policy = activePolicies.get(agent.id);
    safeDispose(policy?.skillDispose);
    safeDispose(policy?.mcpDispose);
    activePolicies.delete(agent.id);
  });

  // Global ToolRuntime changes happen before the next prompt assembly. Refresh
  // only MCP restrictions; restriction changes themselves keep this key stable,
  // so their own tools/change notifications terminate here without recursion.
  onEvent("tools/change", () => {
    const byServer = globalMcpToolsMap();
    const nextKey = mcpInventoryKey(byServer);
    if (nextKey === globalMcpKey) return;
    globalMcpKey = nextKey;
    for (const policy of activePolicies.values()) {
      const next = installMcpPolicy(policy.agent, policy.config, byServer);
      const previous = policy.mcpDispose;
      policy.mcpDispose = next;
      safeDispose(previous);
    }
  });

  onEvent(
    "agent/pre-step",
    async (
      payload: { agent: AgentLike; signal: AbortSignal },
      next: () => Promise<{ kind: string; messages?: Array<Record<string, unknown>> }>,
    ): Promise<{ kind: string; messages?: Array<Record<string, unknown>> }> => {
      payload.signal.throwIfAborted();
      const active = activePolicies.get(payload.agent.id);
      if (active === undefined) {
        // Safe failure for a plugin load racing an already-running Agent: never
        // send the assembly that was built before this workspace policy existed.
        throw new Error("dsh-workspace-scope: workspace policy is not initialized");
      }

      // tool-skill publishes its catalog later in this same pre-step waterfall,
      // so refreshing only Skill shadows here still affects the current step.
      const refreshed = await installSkillPolicy(payload.agent, active.config, payload.signal);
      const previous = active.skillDispose;
      active.skillDispose = refreshed;
      safeDispose(previous);
      return next();
    },
    { prepend: true },
  );

  // HMR/plugin reload can attach after Agents already exist. Idle Agents are
  // reserved immediately; running Agents are initialized as soon as they quiesce.
  for (const agent of agents.list()) {
    const pending =
      agent.status === "idle"
        ? startAgentPolicy(agent)
        : agent.whenIdle().then(() => startAgentPolicy(agent));
    void pending.catch((err: unknown) => {
      ctx.logger.warn(`dsh-workspace-scope: failed to initialize live agent: ${String(err)}`);
    });
  }

  async function overviewResult(sessionId: string): Promise<Record<string, unknown>> {
    const agent = resolveAgent(sessionId);
    const cwd = agent?.session.header.cwd;
    let skillList: Array<{ name: string; description: string }> = [];
    try {
      const snapshot = await skills.snapshot(agent === undefined ? { cwd } : { scope: agent, cwd });
      skillList = snapshot.skills.map((skill) => ({
        name: skill.name,
        description: skill.description ?? "",
      }));
    } catch {
      // An unavailable provider should not break the management UI.
    }

    const byServer = globalMcpToolsMap();
    const mcp = [...byServer.keys()].sort().map((server) => ({
      server,
      toolCount: (byServer.get(server) ?? []).length,
    }));
    return { skills: skillList, mcp, config: await readConfig(cwd) };
  }

  async function saveResult(body: {
    sessionId?: unknown;
    mode?: unknown;
    skills?: unknown;
    mcps?: unknown;
  }): Promise<Record<string, unknown>> {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const agent = resolveAgent(sessionId);
    const cfg: ScopeConfig = {
      mode:
        body.mode === "whitelist" || body.mode === "blacklist"
          ? body.mode
          : "default",
      skills: Array.isArray(body.skills)
        ? body.skills.filter((x): x is string => typeof x === "string")
        : [],
      mcps: Array.isArray(body.mcps)
        ? body.mcps.filter((x): x is string => typeof x === "string")
        : [],
    };
    return writeConfig(agent?.session.header.cwd, cfg, agent?.session);
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        data += chunk;
        if (data.length > MAX_BODY_BYTES) {
          reject(new Error("body too large"));
          req.destroy();
        }
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const send = (status: number, body: unknown): void => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(body));
    };
    try {
      // The dynamic sandbox has no URL/URLSearchParams globals.
      const raw = req.url ?? "/";
      const qIndex = raw.indexOf("?");
      const path = (qIndex === -1 ? raw : raw.slice(0, qIndex)) || "/";
      const sessionIdParam = (): string => {
        if (qIndex === -1) return "";
        for (const pair of raw.slice(qIndex + 1).split("&")) {
          if (pair === "") continue;
          const eq = pair.indexOf("=");
          if ((eq === -1 ? pair : pair.slice(0, eq)) !== "sessionId") continue;
          const value = eq === -1 ? "" : pair.slice(eq + 1);
          try {
            return decodeURIComponent(value);
          } catch {
            return value;
          }
        }
        return "";
      };
      const known =
        path === `${ROUTE_PREFIX}/overview` || path === `${ROUTE_PREFIX}/save`;
      if (req.method === "GET" && path === `${ROUTE_PREFIX}/overview`) {
        send(200, await overviewResult(sessionIdParam()));
      } else if (req.method === "POST" && path === `${ROUTE_PREFIX}/save`) {
        send(200, await saveResult(JSON.parse(await readBody(req)) as Record<string, unknown>));
      } else if (known) {
        send(405, { error: "method not allowed" });
      } else {
        send(404, { error: "not found" });
      }
    } catch (err) {
      send(500, { error: String((err && (err as Error).message) || err) });
    }
  };

  ctx.effect(() => webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }));

  if (typeof harness !== "undefined") {
    harness.handle("overview", async (args: { sessionId?: unknown }) => {
      try {
        return await overviewResult(typeof args?.sessionId === "string" ? args.sessionId : "");
      } catch (err) {
        return { error: String((err && (err as Error).message) || err) };
      }
    });
    harness.handle("save", async (args: unknown) => {
      try {
        return await saveResult((args ?? {}) as Record<string, unknown>);
      } catch (err) {
        return { error: String((err && (err as Error).message) || err) };
      }
    });
  }
}
