import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage, ServerResponse } from "node:http";
import { globalMcpToolsMap } from "./mcp";
import type {
  AgentLike,
  AgentsServiceLike,
  ConfigStore,
  ScopeConfig,
  SkillsServiceLike,
  ToolsServiceLike,
  WebServerLike,
} from "./types";

const ROUTE_PREFIX = "/api/dsh-workspace-scope";
const MAX_BODY_BYTES = 65536;

export interface WorkspaceApi {
  overview(sessionId: string): Promise<Record<string, unknown>>;
  save(body: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface WorkspaceApiDeps {
  agents: AgentsServiceLike;
  skills: SkillsServiceLike;
  tools: ToolsServiceLike;
  configStore: ConfigStore;
}

export function createWorkspaceApi(deps: WorkspaceApiDeps): WorkspaceApi {
  const { agents, skills, tools, configStore } = deps;

  function resolveAgent(sessionId: string): AgentLike | undefined {
    return sessionId === "" ? undefined : agents.get(sessionId);
  }

  async function overview(sessionId: string): Promise<Record<string, unknown>> {
    const agent = resolveAgent(sessionId);
    const cwd = agent?.session.header.cwd;
    let skillList: Array<{ name: string; description: string }> = [];

    // DSH tool-skill publishes a model catalog only when a `skill` Tool is
    // visible to this Agent. Exact private tool-skill identity remains outside
    // the public seam, so scoped presence is the narrowest supported gate.
    if (agent !== undefined && tools.get("skill", agent) !== undefined) {
      const snapshot = await skills.snapshot({ scope: agent, cwd });
      if (!snapshot.complete) {
        throw new Error("dsh-workspace-scope: skill catalog is incomplete");
      }
      skillList = snapshot.skills
        .filter((skill) => skill.invocation?.modelInvocable !== false)
        .map((skill) => ({
          name: skill.name,
          description: skill.description ?? "",
        }));
    }

    const byServer = globalMcpToolsMap(tools);
    const mcp = [...byServer.keys()].sort().map((server) => ({
      server,
      toolCount: (byServer.get(server) ?? []).length,
    }));
    return { skills: skillList, mcp, config: await configStore.read(cwd) };
  }

  async function save(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const agent = resolveAgent(sessionId);
    const config: ScopeConfig = {
      mode:
        body.mode === "whitelist" || body.mode === "blacklist"
          ? body.mode
          : "default",
      skills: Array.isArray(body.skills)
        ? body.skills.filter((item): item is string => typeof item === "string")
        : [],
      mcps: Array.isArray(body.mcps)
        ? body.mcps.filter((item): item is string => typeof item === "string")
        : [],
    };
    return configStore.write(agent?.session.header.cwd, config, agent?.session);
  }

  return { overview, save };
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

function sessionIdFromUrl(raw: string): string {
  const qIndex = raw.indexOf("?");
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
}

export function registerHttpApi(
  ctx: Context,
  webServer: WebServerLike,
  api: WorkspaceApi,
): void {
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
      const known =
        path === `${ROUTE_PREFIX}/overview` || path === `${ROUTE_PREFIX}/save`;

      if (req.method === "GET" && path === `${ROUTE_PREFIX}/overview`) {
        send(200, await api.overview(sessionIdFromUrl(raw)));
      } else if (req.method === "POST" && path === `${ROUTE_PREFIX}/save`) {
        send(200, await api.save(JSON.parse(await readBody(req)) as Record<string, unknown>));
      } else if (known) {
        send(405, { error: "method not allowed" });
      } else {
        send(404, { error: "not found" });
      }
    } catch (error) {
      send(500, { error: String((error && (error as Error).message) || error) });
    }
  };

  ctx.effect(() => webServer.register({ kind: "prefix", path: ROUTE_PREFIX, handler }));
}
