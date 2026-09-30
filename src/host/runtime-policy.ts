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
  SkillAccess,
  SkillsServiceLike,
  SystemPromptLike,
  ToolsServiceLike,
} from "./types.js";

type PolicyDispose = () => void | Promise<void>;

interface ActivePolicy {
  config: ScopeConfig;
  mcpKey?: string;
  skillDispose?: PolicyDispose;
  mcpDispose?: PolicyDispose;
}

interface RuntimePolicyDeps {
  configStore: ConfigStore;
  skills: SkillsServiceLike;
  tools: ToolsServiceLike;
  systemPrompt: SystemPromptLike;
  skillAccess: SkillAccess;
}

export function registerRuntimePolicy(ctx: Context, deps: RuntimePolicyDeps): void {
  const { configStore, skills, tools, systemPrompt, skillAccess } = deps;
  const activePolicies = new Map<string, ActivePolicy>();
  const onEvent = ctx.on as unknown as (
    name: string,
    listener: (...args: never[]) => unknown,
    options?: boolean | { prepend?: boolean },
  ) => unknown;
  const dispose = async (fn: PolicyDispose | undefined): Promise<void> => {
    if (fn === undefined) return;
    try {
      await fn();
    } catch {
      // Agent scope teardown may already have removed the registration.
    }
  };

  // Agent-scoped Skill/Tool registrations below are adopted by this plugin
  // through ctx.effect(). Dynamic effects unwind before this state cleanup.
  ctx.effect(() => () => {
    activePolicies.clear();
  }, "workspace-scope:policy-state");

  onEvent("agent/disposed", ({ agent }: { agent: AgentLike }) => {
    const policy = activePolicies.get(agent.id);
    activePolicies.delete(agent.id);
    void dispose(policy?.skillDispose);
    void dispose(policy?.mcpDispose);
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
        active = { config };
        activePolicies.set(agent.id, active);
      }

      const denied = deniedMcpTools(active.config, globalMcpToolsMap(tools));
      const key = JSON.stringify(denied);
      if (active.mcpKey === key) return next();

      const replacement = denied.length === 0
        ? undefined
        : ctx.effect(
            () => getAgentService<ScopedToolsLike>(agent, "tools").restrict({ deny: denied }),
            "workspace-scope:mcp-policy",
          );
      const previous = active.mcpDispose;
      active.mcpDispose = replacement;
      active.mcpKey = key;
      await dispose(previous);

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

      await skillAccess(async () => {
        // Keep the previous shadow installed while queued. Once this Agent owns
        // the registry transaction, expose the underlying catalog, rebuild the
        // shadows, and verify them before any downstream pre-step consumer runs.
        payload.signal.throwIfAborted();
        const previous = active.skillDispose;
        delete active.skillDispose;
        await dispose(previous);
        payload.signal.throwIfAborted();
        const replacement = ctx.effect(
          async () => (await installSkillPolicy(
            skills,
            tools,
            payload.agent,
            active.config,
            payload.signal,
          )) ?? (() => {}),
          "workspace-scope:skill-policy",
        );
        await replacement;
        active.skillDispose = replacement;
      });
      return next();
    },
    { prepend: true },
  );
}
