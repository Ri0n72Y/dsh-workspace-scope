import type { Context } from "@deepseek-ai/cordis";
import type {
  ConfigStore,
  FsServiceLike,
  SandboxPolicyServiceLike,
  ScopeConfig,
} from "./types";

const CONFIG_FILE = ".dsh-scope.json";
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

export function createConfigStore(ctx: Context, fs: FsServiceLike): ConfigStore {
  // One queue is enough for this small workspace-local document. Reads wait for
  // already-started writes so overview / first-turn policy cannot observe stale data.
  let writeQueue: Promise<void> = Promise.resolve();

  async function read(cwd: string | undefined): Promise<ScopeConfig> {
    await writeQueue;
    if (cwd === undefined || cwd === "") return defaultConfig();
    try {
      const target = await fs.resolve(`${cwd}/${CONFIG_FILE}`);
      return parseScopeConfig(await fs.readText(target));
    } catch {
      return defaultConfig();
    }
  }

  function write(
    cwd: string | undefined,
    config: ScopeConfig,
    session: Parameters<ConfigStore["write"]>[2],
  ): ReturnType<ConfigStore["write"]> {
    const pending = writeQueue.then(async () => {
      if (cwd === undefined || cwd === "") {
        return { saved: false, reason: "无法确定工作目录，未保存" };
      }
      try {
        const target = await fs.resolve(`${cwd}/${CONFIG_FILE}`);
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
