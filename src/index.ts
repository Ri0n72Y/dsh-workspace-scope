/**
 * dsh-workspace-scope — Host half.
 *
 * 按工作区（工程）启停 Skill 与 MCP：每个工作区一份 .dsh-scope.json 配置
 * （组合模式：default 全开 / whitelist 只启用勾选 / blacklist 排除勾选），
 * 新会话首轮起按当前工作区配置裁剪技能目录与 MCP 工具。
 *
 * Endpoints (same-origin browser fetch):
 *   GET  /api/dsh-workspace-scope/overview?sessionId=<id>
 *        -> { skills: [{name,description}], mcp: [{server,toolCount}], config: ScopeConfig }
 *   POST /api/dsh-workspace-scope/save  body {sessionId, mode, skills[], mcps[]}
 *        -> { saved: boolean, reason?: string }
 *
 * 只读写工作区内的 .dsh-scope.json；不碰 profile / cordis.yml / 全局配置。
 * 会话内临时启用走 DSH 原生 /<skill> 手势（不受目录过滤影响）。
 *
 * @module dsh-workspace-scope
 */

import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";

// Dual-environment: the dynamic (plugin-dev-loop) host sandbox provides the
// `harness` binding for Package-private RPC; the static bundle has none
// (typeof guard) and serves the browser bundle over webServer routes instead.
declare const harness: any;

export const name = "dsh-workspace-scope";

/** Hard dependency: the browser HTTP carrier service. */
export const inject = ["webServer"];

const CONFIG_FILE = ".dsh-scope.json";
const ROUTE_PREFIX = "/api/dsh-workspace-scope";
const MAX_BODY_BYTES = 65536;

type ScopeMode = "default" | "whitelist" | "blacklist";

/** Per-workspace enablement config. */
interface ScopeConfig {
  mode: ScopeMode;
  /** whitelist: enabled skill/server names; blacklist: excluded names. */
  skills: string[];
  mcps: string[];
}

const DEFAULT_CONFIG: ScopeConfig = { mode: "default", skills: [], mcps: [] };

/**
 * Parse a .dsh-scope.json document into a ScopeConfig.
 *
 * Pure function (no fs, no ctx) so the legacy/default/blacklist reading
 * semantics are unit-testable. Unknown or malformed input degrades to
 * DEFAULT_CONFIG; string-typed entries are kept, everything else dropped.
 */
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
  if (typeof row !== "object" || row === null) return { ...DEFAULT_CONFIG };
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

// ── local structural types (keeps this package free of hard type deps) ──────

interface McpSkillsRoute {
  kind: "exact" | "prefix";
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
interface McpSkillsWebServer {
  register(route: McpSkillsRoute): () => void;
}
interface AgentLike {
  id: string;
  session: { header: { cwd: string } };
}
interface SessionLike {
  header: { cwd: string };
}
interface AgentsServiceLike {
  get(id: string): AgentLike | undefined;
}
interface SkillsServiceLike {
  snapshot(
    options: unknown,
  ): Promise<{ skills: SkillSummaryLike[]; complete: boolean }>;
  get(name: string, options: unknown): Promise<SkillDefinitionLike | undefined>;
}
interface SkillSummaryLike {
  name: string;
  description?: string;
  invocation?: { modelInvocable?: boolean };
}
interface SkillDefinitionLike extends SkillSummaryLike {
  content?: string;
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

/** Servers to deny for this session under the workspace config. */
export function deniedServers(
  cfg: ScopeConfig,
  allServers: string[],
): string[] {
  if (cfg.mode === "default") return [];
  if (cfg.mode === "whitelist")
    return allServers.filter((s) => !cfg.mcps.includes(s));
  return cfg.mcps.filter((s) => allServers.includes(s));
}

/** Skill names to keep in the injected catalog under the workspace config. */
export function keptSkillNames(
  cfg: ScopeConfig,
  catalogNames: string[],
): string[] | null {
  // null = keep everything (default mode)
  if (cfg.mode === "default") return null;
  if (cfg.mode === "whitelist")
    return catalogNames.filter((n) => cfg.skills.includes(n));
  return catalogNames.filter((n) => !cfg.skills.includes(n));
}

export function apply(ctx: Context): void {
  const webServer = ctx.get("webServer") as McpSkillsWebServer | undefined;
  if (webServer === undefined) {
    throw new Error("dsh-workspace-scope: webServer is unavailable");
  }

  // ── config persistence (workspace-local only) ─────────────────────────────

  async function readConfig(cwd: string | undefined): Promise<ScopeConfig> {
    const fs = ctx.get("fs") as FsServiceLike | undefined;
    if (fs === undefined || cwd === undefined || cwd === "")
      return { ...DEFAULT_CONFIG };
    try {
      const target = await fs.resolve(`${cwd}/${CONFIG_FILE}`);
      return parseScopeConfig(await fs.readText(target));
    } catch {
      /* missing or unreadable -> defaults */
    }
    return { ...DEFAULT_CONFIG };
  }

  async function writeConfig(
    cwd: string | undefined,
    cfg: ScopeConfig,
    session: SessionLike | undefined,
  ): Promise<{ saved: boolean; reason?: string }> {
    const fs = ctx.get("fs") as FsServiceLike | undefined;
    if (fs === undefined || cwd === undefined || cwd === "") {
      return { saved: false, reason: "无法确定工作目录，未保存" };
    }
    try {
      const target = await fs.resolve(`${cwd}/${CONFIG_FILE}`);
      let all: Record<string, unknown> = {};
      try {
        const text = await fs.readText(target);
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed === "object" && parsed !== null)
          all = parsed as Record<string, unknown>;
      } catch {
        /* start fresh */
      }
      all.default = cfg;
      const sp = ctx.get("sandboxPolicy") as
        | SandboxPolicyServiceLike
        | undefined;
      // Saving the workspace scope is a user-facing UI management operation
      // (the hero modal), not an agent file operation: always resolve with an
      // explicit workspace-write mode so a read-only session cannot brick the
      // feature. The boundary stays the session's workspace root.
      const policy =
        sp !== undefined && session !== undefined
          ? sp.resolve({ session, mode: "workspace-write" })
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
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  function resolveAgent(sessionId: string): AgentLike | undefined {
    if (sessionId === "") return undefined;
    const agents = ctx.get("agents") as AgentsServiceLike | undefined;
    return agents?.get(sessionId);
  }

  function serverToolsMap(): Map<string, string[]> {
    const byServer = new Map<string, string[]>();
    const tools = ctx.get("tools") as ToolsServiceLike | undefined;
    if (tools !== undefined) {
      for (const schema of tools.schemas()) {
        if (typeof schema.name !== "string" || !schema.name.startsWith("mcp__"))
          continue;
        const m = /^mcp__(.+?)__(.+)$/.exec(schema.name);
        if (m === null) continue;
        const server = m[1] ?? "";
        const arr = byServer.get(server) ?? [];
        if (arr.length === 0) byServer.set(server, arr);
        arr.push(schema.name);
      }
    }
    return byServer;
  }

  function escapeHtml(value: string): string {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function renderCatalogText(
    form: "catalog" | "update",
    entries: Array<{ name: string; description: string }>,
  ): string {
    const lines = entries.map(
      (e) => `- \`${e.name}\`: ${escapeHtml(e.description)}`,
    );
    if (form === "update") {
      const availability =
        entries.length === 0
          ? [
              "No skills are currently available through the `skill` tool. Do not use names from earlier skill catalogs.",
              "A user may still invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool for it.",
            ]
          : [
              "Use only names in this replacement catalog. If the user names a listed skill, or the task clearly matches its description, call the `skill` tool with the exact name before acting.",
              "A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.",
            ];
      return [
        "<system-reminder>",
        "The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:",
        "",
        "<available_skills>",
        ...lines,
        "</available_skills>",
        "",
        ...availability,
        "</system-reminder>",
      ].join("\n");
    }
    return [
      "<system-reminder>",
      "A skill is a reusable set of task-specific instructions. The following skills are available in this session:",
      "",
      "<available_skills>",
      ...lines,
      "</available_skills>",
      "",
      "If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.",
      "A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.",
      "</system-reminder>",
    ].join("\n");
  }

  /** Replace the tool-skill catalog message with the dsh-workspace-scoped view. */
  function filterCatalogMessages(
    messages: Array<Record<string, unknown>>,
    keep: string[] | null,
  ): Array<Record<string, unknown>> {
    if (keep === null) return messages;
    const keepSet = new Set(keep);
    const result: Array<Record<string, unknown>> = [];
    let changed = false;
    for (const message of messages) {
      const src = message.source as
        | { kind?: unknown; update?: unknown; entries?: unknown }
        | undefined;
      if (
        src !== undefined &&
        src.kind === "skill-catalog" &&
        Array.isArray(src.entries)
      ) {
        const entries = (
          src.entries as Array<{ name?: unknown; description?: unknown }>
        ).filter(
          (e): e is { name: string; description: string } =>
            typeof e === "object" &&
            e !== null &&
            typeof e.name === "string" &&
            typeof e.description === "string",
        );
        const kept = entries.filter((e) => keepSet.has(e.name));
        if (kept.length === entries.length) {
          result.push(message);
        } else if (kept.length === 0) {
          changed = true; // drop the catalog entirely: model sees no skills
        } else {
          changed = true;
          const form = src.update === true ? "update" : "catalog";
          // The model sees the trimmed text only, but source.entries stay the
          // FULL list: tool-skill's stability check (catalogHistory) digests
          // the last model-visible catalog message and re-publishes whenever
          // it differs from the full snapshot. Entries = full keeps that
          // digest stable, so no catalog is re-injected on later steps.
          result.push({
            id: message.id,
            role: "user",
            content: [{ type: "text", text: renderCatalogText(form, kept) }],
            source: {
              kind: "skill-catalog",
              form,
              entries,
              // Keep the update marker so readers that distinguish an initial
              // catalog from a replacement stay correct after the rebuild.
              ...(src.update === true ? { update: true as const } : {}),
            },
          });
        }
        continue;
      }
      result.push(message);
    }
    return changed ? result : messages;
  }

  const appliedRestrictions = new Map<
    string,
    { dispose: () => void; deny: string[] }
  >();
  // Per-agent config lock: a conversation keeps the config it started with,
  // even when the workspace scope is edited later ("对话开始后不可更改").
  const appliedConfigs = new Map<string, ScopeConfig>();
  // Most-recently-known config per agent/session: the synchronous
  // tools/pre-execute guard can only read a cache, never await a file read.
  const lastConfigs = new Map<string, ScopeConfig>();

  async function applyRestriction(
    agent: AgentLike,
    cfg: ScopeConfig,
  ): Promise<void> {
    const byServer = serverToolsMap();
    const allServers = [...byServer.keys()];
    const denied = deniedServers(cfg, allServers);
    const deny: string[] = [];
    for (const server of denied) deny.push(...(byServer.get(server) ?? []));
    const prev = appliedRestrictions.get(agent.id);
    const same =
      prev !== undefined &&
      prev.deny.length === deny.length &&
      deny.every((name, index) => name === prev.deny[index]);
    if (same) return;
    if (prev !== undefined) {
      try {
        prev.dispose();
      } catch {
        /* already gone */
      }
      appliedRestrictions.delete(agent.id);
    }
    if (deny.length === 0) return;
    try {
      const tools = (agent as unknown as { ctx: Record<string, unknown> }).ctx
        .tools as {
        restrict(filter: { deny: string[] }): () => void;
      };
      appliedRestrictions.set(agent.id, {
        dispose: tools.restrict({ deny }),
        deny,
      });
    } catch (err) {
      console.warn(
        "[dsh-workspace-scope] restrict failed:",
        String((err && (err as Error).message) || err),
      );
    }
  }

  // ── pre-step: filter the skill catalog + restrict MCP for this workspace ───

  // External packages have no DSH event-name declaration merge; the runtime
  // event names are stable strings (agent/pre-step, tools/pre-execute,
  // agent/disposed).
  const onEvent = ctx.on as unknown as (
    name: string,
    listener: (...args: never[]) => unknown,
    options?: boolean | { prepend?: boolean },
  ) => unknown;

  // Drop restriction bookkeeping when an agent goes away.
  onEvent("agent/disposed", (agent: AgentLike) => {
    const prev = appliedRestrictions.get(agent.id);
    if (prev !== undefined) {
      try {
        prev.dispose();
      } catch {
        /* already gone */
      }
      appliedRestrictions.delete(agent.id);
    }
    appliedConfigs.delete(agent.id);
    lastConfigs.delete(agent.id);
  });

  onEvent(
    "agent/pre-step",
    async (
      payload: {
        agent: AgentLike;
        messages: Array<Record<string, unknown>>;
        signal: AbortSignal;
      },
      next: () => Promise<{
        kind: string;
        messages?: Array<Record<string, unknown>>;
      }>,
    ): Promise<{ kind: string; messages?: Array<Record<string, unknown>> }> => {
      const decision = await next();
      if (decision.kind === "reject") return decision;
      payload.signal.throwIfAborted();
      // First step of a conversation locks the workspace config for its whole
      // lifetime; later workspace edits do not change running conversations.
      let cfg = appliedConfigs.get(payload.agent.id);
      if (cfg === undefined) {
        const cwd = payload.agent.session?.header.cwd;
        cfg = await readConfig(cwd);
        appliedConfigs.set(payload.agent.id, cfg);
      }
      lastConfigs.set(payload.agent.id, cfg);
      await applyRestriction(payload.agent, cfg);
      return decision;
    },
  );

  // Final catalog trim, registered outermost (prepend). Cordis waterfalls run
  // listeners outermost-first, so this listener is the LAST to see the batch:
  // tool-skill, registered earlier, appends the full catalog at the end of
  // the chain, and only a listener outside it can filter that message.
  onEvent(
    "agent/pre-step",
    async (
      payload: {
        agent: AgentLike;
        messages: Array<Record<string, unknown>>;
        signal: AbortSignal;
      },
      next: () => Promise<{
        kind: string;
        messages?: Array<Record<string, unknown>>;
      }>,
    ): Promise<{ kind: string; messages?: Array<Record<string, unknown>> }> => {
      const decision = await next();
      if (decision.kind === "reject") return decision;
      payload.signal.throwIfAborted();
      const cfg =
        appliedConfigs.get(payload.agent.id) ??
        lastConfigs.get(payload.agent.id);
      if (cfg === undefined) return decision;
      const messages = decision.messages ?? payload.messages;
      if (messages === undefined) return decision;
      const catalogNames = messages.flatMap((m) => {
        const src = m.source as
          | { kind?: unknown; entries?: unknown }
          | undefined;
        if (src?.kind !== "skill-catalog" || !Array.isArray(src.entries))
          return [];
        return (src.entries as Array<{ name?: unknown }>)
          .filter((e): e is { name: string } => typeof e?.name === "string")
          .map((e) => e.name);
      });
      const keep = keptSkillNames(cfg, catalogNames);
      const filtered = filterCatalogMessages(messages, keep);
      if (filtered === messages) return decision;
      return { kind: "enter", messages: filtered };
    },
    { prepend: true },
  );

  // Belt-and-braces: deny the `skill` TOOL for skills the workspace config
  // excludes (the catalog filter already keeps them invisible). The user
  // /<name> gesture is a separate injection path and stays available.
  onEvent(
    "tools/pre-execute",
    (
      exec: {
        name?: unknown;
        agent?: AgentLike;
        arguments?: Record<string, unknown>;
      },
      next: () => unknown,
    ): unknown => {
      if (exec?.name !== "skill" || exec.agent === undefined) return next();
      const cfgCache = lastConfigs.get(exec.agent.id);
      if (cfgCache === undefined || cfgCache.mode === "default") return next();
      const name =
        typeof exec.arguments?.name === "string" ? exec.arguments.name : "";
      const excluded =
        cfgCache.mode === "whitelist"
          ? !cfgCache.skills.includes(name)
          : cfgCache.skills.includes(name);
      if (name !== "" && excluded) {
        return {
          kind: "deny",
          reason: `skill "${name}" is excluded by the workspace scope config`,
        };
      }
      return next();
    },
  );

  // ── routes ────────────────────────────────────────────────────────────────

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

  async function overviewResult(
    sessionId: string,
  ): Promise<Record<string, unknown>> {
    const agent = resolveAgent(sessionId);
    const cwd = agent?.session.header.cwd;

    const skillsService = ctx.get("skills") as SkillsServiceLike | undefined;
    let skillList: Array<{ name: string; description: string }> = [];
    if (skillsService !== undefined) {
      try {
        const viewOptions = agent !== undefined ? { scope: agent, cwd } : {};
        const snap = await skillsService.snapshot(viewOptions);
        skillList = (snap.skills ?? [])
          .filter((s) => s.invocation?.modelInvocable !== false)
          .map((s) => ({ name: s.name, description: s.description ?? "" }));
      } catch {
        /* empty list on failure */
      }
    }
    const byServer = serverToolsMap();
    const mcp = [...byServer.keys()].sort().map((server) => ({
      server,
      toolCount: (byServer.get(server) ?? []).length,
    }));
    const config = await readConfig(cwd);
    lastConfigs.set(sessionId, config);
    return { skills: skillList, mcp, config };
  }

  async function saveResult(body: {
    sessionId?: unknown;
    mode?: unknown;
    skills?: unknown;
    mcps?: unknown;
  }): Promise<Record<string, unknown>> {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const agent = resolveAgent(sessionId);
    const cwd = agent?.session.header.cwd;
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
    const result = await writeConfig(cwd, cfg, agent?.session);
    // Apply immediately only for conversations that have not locked their
    // config yet (a fresh blank session); running conversations keep theirs.
    if (result.saved && agent !== undefined && !appliedConfigs.has(agent.id)) {
      lastConfigs.set(sessionId, cfg);
      await applyRestriction(agent, cfg);
    }
    return result;
  }

  const handler = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const send = (status: number, body: unknown): void => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const known =
        path === `${ROUTE_PREFIX}/overview` || path === `${ROUTE_PREFIX}/save`;
      if (req.method === "GET" && path === `${ROUTE_PREFIX}/overview`) {
        send(
          200,
          await overviewResult(url.searchParams.get("sessionId") ?? ""),
        );
      } else if (req.method === "POST" && path === `${ROUTE_PREFIX}/save`) {
        const body = JSON.parse(await readBody(req)) as {
          sessionId?: unknown;
          mode?: unknown;
          skills?: unknown;
          mcps?: unknown;
        };
        send(200, await saveResult(body));
      } else if (known) {
        send(405, { error: "method not allowed" });
      } else {
        send(404, { error: "not found" });
      }
    } catch (err) {
      send(500, { error: String((err && (err as Error).message) || err) });
    }
  };

  ctx.effect(() =>
    webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }),
  );

  // Dynamic (plugin-dev-loop) environment: the client half calls through
  // host.call because the sandbox forbids fetch; the static bundle skips this
  // (typeof guard) and uses the webServer routes above.
  if (typeof harness !== "undefined") {
    harness.handle("overview", async (args: { sessionId?: unknown }) => {
      try {
        return await overviewResult(
          typeof args?.sessionId === "string" ? args.sessionId : "",
        );
      } catch (err) {
        return { error: String((err && (err as Error).message) || err) };
      }
    });
    harness.handle("save", async (args: unknown) => {
      try {
        return await saveResult(
          (args ?? {}) as {
            sessionId?: unknown;
            mode?: unknown;
            skills?: unknown;
            mcps?: unknown;
          },
        );
      } catch (err) {
        return { error: String((err && (err as Error).message) || err) };
      }
    });
  }
}
