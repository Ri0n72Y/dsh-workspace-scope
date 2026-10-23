import type { Context } from "@deepseek-ai/cordis";
import type { ScopeResolver } from "./scope-location.js";
import type {
  ConfigStore,
  FsServiceLike,
  SandboxPolicyServiceLike,
  ScopeConfig,
} from "./types.js";

const DEFAULT_CONFIG: ScopeConfig = { mode: "default", skills: [], mcps: [] };

function defaultConfig(): ScopeConfig {
  return { ...DEFAULT_CONFIG, skills: [], mcps: [] };
}

export function parseScopeConfig(text: string | undefined): ScopeConfig {
  if (text === undefined || text === "") return defaultConfig();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return defaultConfig();
  }
  const row =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { default?: unknown }).default
      : undefined;
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return defaultConfig();
  }
  const value = row as { mode?: unknown; skills?: unknown; mcps?: unknown };
  return {
    mode:
      value.mode === "whitelist" || value.mode === "blacklist"
        ? value.mode
        : "default",
    skills: Array.isArray(value.skills)
      ? value.skills.filter((item): item is string => typeof item === "string")
      : [],
    mcps: Array.isArray(value.mcps)
      ? value.mcps.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export function createConfigStore(
  ctx: Context,
  fs: FsServiceLike,
  resolver: ScopeResolver,
): ConfigStore {
  // One queue is enough for these small workspace-local documents. Reads wait for
  // already-started writes so overview / first-turn policy cannot observe stale data.
  let writeQueue: Promise<void> = Promise.resolve();

  async function read(
    session: Parameters<ConfigStore["read"]>[0],
    signal?: AbortSignal,
  ): Promise<ScopeConfig> {
    await writeQueue;
    try {
      const location = await resolver.locate(session, signal);
      if (!location.exists) return defaultConfig();
      return parseScopeConfig(await fs.readText(location.target, signal));
    } catch {
      return defaultConfig();
    }
  }

  function write(
    session: Parameters<ConfigStore["write"]>[0],
    config: ScopeConfig,
  ): ReturnType<ConfigStore["write"]> {
    const pending = writeQueue.then(async () => {
      const cwd = session?.header.cwd;
      if (cwd === undefined || cwd === "") {
        return { saved: false, reason: "无法确定工作目录，未保存" };
      }
      try {
        // Save edits the file this Session reads: the nearest scope file up to
        // the header cwd, or a new one at the header cwd.
        const location = await resolver.locate(session);
        if (location.path === undefined || !location.writable) {
          return {
            saved: false,
            reason: `dsh-workspace-scope: ${location.path ?? "the scope file"} is not a regular file inside the workspace, not saved`,
          };
        }
        const target = location.target;
        let document: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(await fs.readText(target)) as unknown;
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            document = parsed as Record<string, unknown>;
          }
        } catch {
          // Missing or invalid file: write a fresh document.
        }
        document.default = config;

        // Optional by design: ctx.get() is a soft registry lookup and does not
        // require this plugin to declare a hard sandboxPolicy dependency.
        const sandboxPolicy = ctx.get("sandboxPolicy") as SandboxPolicyServiceLike | undefined;
        const policy =
          sandboxPolicy !== undefined && session !== undefined
            ? sandboxPolicy.resolve({ session, mode: "workspace-write" })
            : undefined;
        await fs.writeText(
          target,
          JSON.stringify(document, null, 2),
          undefined,
          undefined,
          policy,
        );
        return { saved: true };
      } catch (error) {
        return {
          saved: false,
          reason: String((error && (error as Error).message) || error),
        };
      }
    });
    writeQueue = pending.then(() => undefined);
    return pending;
  }

  return { read, write };
}
