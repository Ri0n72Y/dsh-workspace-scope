import { disposeAll } from "./dispose";
import { deniedSkills } from "./policy";
import { getAgentService } from "./scoped-service";
import type {
  AgentLike,
  ScopeConfig,
  ScopedSkillsLike,
  SkillsServiceLike,
  ToolsServiceLike,
} from "./types";

export async function installSkillPolicy(
  skills: SkillsServiceLike,
  tools: ToolsServiceLike,
  agent: AgentLike,
  config: ScopeConfig,
  signal: AbortSignal,
): Promise<(() => void) | undefined> {
  if (config.mode === "default" || tools.get("skill", agent) === undefined) {
    return undefined;
  }

  const view = { scope: agent, cwd: agent.session.header.cwd, signal };
  const snapshot = await skills.snapshot(view);
  signal.throwIfAborted();
  if (!snapshot.complete) {
    throw new Error("dsh-workspace-scope: skill catalog is incomplete");
  }

  const denied = new Set(deniedSkills(config, snapshot.skills.map((skill) => skill.name)));
  if (denied.size === 0) return undefined;

  // Do not read agent.ctx.skills directly. The Agent fiber does not itself
  // inject the SkillRegistry in DSH 0.1.5-rc.1, so Cordis rejects that property
  // access. ctx.get() deliberately bypasses the inject requirement while its
  // traceable service face still binds method calls to this exact Agent scope.
  const scopedSkills = getAgentService<ScopedSkillsLike>(agent, "skills");
  const disposers: Array<() => void> = [];
  try {
    for (const summary of snapshot.skills) {
      if (!denied.has(summary.name) || summary.invocation?.modelInvocable === false) continue;
      const definition = await skills.get(summary.name, view);
      signal.throwIfAborted();
      if (definition === undefined || definition.invocation?.modelInvocable === false) continue;
      disposers.push(
        scopedSkills.register({
          ...definition,
          invocation: {
            ...definition.invocation,
            modelInvocable: false,
            userInvocable: definition.invocation?.userInvocable !== false,
          },
        }),
      );
    }

    const verified = await skills.snapshot(view);
    signal.throwIfAborted();
    if (!verified.complete) {
      throw new Error("dsh-workspace-scope: skill catalog is incomplete");
    }
    const verifiedDenied = new Set(
      deniedSkills(config, verified.skills.map((skill) => skill.name)),
    );
    const exposed = verified.skills.find(
      (skill) => verifiedDenied.has(skill.name) && skill.invocation?.modelInvocable !== false,
    );
    if (exposed !== undefined) {
      throw new Error(`dsh-workspace-scope: failed to hide skill "${exposed.name}"`);
    }

    return disposers.length === 0 ? undefined : () => disposeAll(disposers);
  } catch (error) {
    disposeAll(disposers);
    throw error;
  }
}
