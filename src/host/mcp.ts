import { deniedServers } from "./policy";
import type { ScopeConfig, ToolsServiceLike } from "./types";

const MCP_TOOL_NAME = /^mcp__([A-Za-z0-9_-]{1,32}?)__(.+)$/;

export function globalMcpToolsMap(tools: ToolsServiceLike): Map<string, string[]> {
  const byServer = new Map<string, string[]>();
  // ToolSchema has no MCP owner metadata. Split on the first `__`; serverName
  // containing `__` stays outside 0.5's exact support boundary.
  for (const schema of tools.schemas()) {
    const match = MCP_TOOL_NAME.exec(schema.name);
    if (match === null) continue;
    const server = match[1]!;
    const names = byServer.get(server) ?? [];
    if (!byServer.has(server)) byServer.set(server, names);
    names.push(schema.name);
  }
  return byServer;
}

export function deniedMcpTools(
  config: ScopeConfig,
  byServer: Map<string, string[]>,
): string[] {
  return deniedServers(config, [...byServer.keys()])
    .flatMap((server) => byServer.get(server) ?? [])
    .sort();
}
