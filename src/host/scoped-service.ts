import type { AgentLike } from "./types";

/**
 * Resolve a service through the Agent's scoped Context without requiring the
 * Agent fiber itself to declare that service as an injected dependency.
 *
 * Cordis ctx.get() returns the traceable service face rebound to the caller
 * Context, so service methods that inspect their calling context (for example
 * SkillRegistry.register() / ToolRuntime.restrict()) still see the exact Agent
 * scope rather than the provider's Host scope.
 */
export function getAgentService<T>(agent: AgentLike, name: string): T {
  const service = agent.ctx.get(name) as T | undefined;
  if (service === undefined) {
    throw new Error(`dsh-workspace-scope: ${name} service is unavailable for agent`);
  }
  return service;
}
