import type { Context } from "@deepseek-ai/cordis";
import { deniedMcpTools, globalMcpToolsMap } from "./mcp.js";
import { getAgentService } from "./scoped-service.js";
import { installSkillPolicy } from "./skill-policy.js";
import type {
  AgentLike,
  AssembleContextLike,
  ConfigStore,
  PromptAssemblyLike,
  ScopeConfig,
  ScopedToolsLike,
  SkillsServiceLike,
  SystemPromptLike,
  ToolsServiceLike,
} from "./types.js";

interface ActivePolicy {
  agent: AgentLike;
  config: ScopeConfig;
  mcpKey?: string;
  skillDispose?: () => void;
  mcpDispose?: () => void;
}

interface RuntimePolicyDeps {
  configStore: ConfigStore;
  skills: SkillsServiceLike;
  tools: ToolsServiceLike;
  systemPrompt: SystemPromptLike;
}

export function registerRuntimePolicy(ctx: Context, deps: RuntimePolicyDeps): void {
  const { configStore, skills, tools, systemPrompt } = deps;
  const activePolicies = new Map<string, ActivePolicy>();
  const onEvent = ctx.on as unknown as (
    name: string,
    listener: (...args: never[]) => unknown,
    options?: boolean | { prepend?: boolean },
  ) => unknown;
  const dispose = (fn: (() => void) | undefined) => {
    if (fn === undefined) return;
    try {
      fn();
    } catch {
      // Agent scope teardown may already have removed the registration.
    }
  };

  ctx.effect(() => () => {
    for (const policy of activePolicies.values()) {
      dispose(policy.skillDispose);
      dispose(policy.mcpDispose);
    }
    activePolicies.clear();
  });

  onEvent("agent/disposed", ({ agent }: { agent: AgentLike }) => {
    const policy = activePolicies.get(agent.id);
    dispose(policy?.skillDispose);
    dispose(policy?.mcpDispose);
    activePolicies.delete(agent.id);
  });

  // The AgentLoop assembles before agent/pre-step. Lock config at the first
  // turn-owned assembly. If the MCP mask changes, rebuild once under the new
  // ToolRuntime restriction so native and PTC presentations stay aligned.
  onEvent(
    "system-prompt/assemble",
    async (
      _assembly: PromptAssemblyLike,
      context: AssembleContextLike,
      next: () => Promise<PromptAssemblyLike>,
    ): Promise<PromptAssemblyLike> => {
      const agent = context.agent;
      const signal = context.signal;
      if (agent === undefined || signal === undefined) return next();
      signal.throwIfAborted();

      let active = activePolicies.get(agent.id);
      if (active === undefined) {
        const config = await configStore.read(agent.session.header.cwd);
        signal.throwIfAborted();
        active = { agent, config };
        activePolicies.set(agent.id, active);
      }

      const denied = deniedMcpTools(active.config, globalMcpToolsMap(tools));
      const key = JSON.stringify(denied);
      if (active.mcpKey === key) return next();

      const replacement = denied.length === 0
        ? undefined
        : getAgentService<ScopedToolsLike>(agent, "tools").restrict({ deny: denied });
      const previous = active.mcpDispose;
      active.mcpDispose = replacement;
      active.mcpKey = key;
      dispose(previous);

      if (previous === undefined && replacement === undefined) return next();
      signal.throwIfAborted();
      return systemPrompt.assemble(context);
    },
    { prepend: true },
  );

  onEvent(
    "agent/pre-step",
    async (
      payload: { agent: AgentLike; signal: AbortSignal },
      next: () => Promise<{ kind: string; messages?: Array<Record<string, unknown>> }>,
    ): Promise<{ kind: string; messages?: Array<Record<string, unknown>> }> => {
      payload.signal.throwIfAborted();
      const active = activePolicies.get(payload.agent.id);
      if (active === undefined) {
        throw new Error("dsh-workspace-scope: workspace policy is not initialized");
      }

      const previous = active.skillDispose;
      delete active.skillDispose;
      dispose(previous);
      active.skillDispose = await installSkillPolicy(
        skills,
        tools,
        payload.agent,
        active.config,
        payload.signal,
      );
      return next();
    },
    { prepend: true },
  );
}
