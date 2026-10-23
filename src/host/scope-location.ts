/**
 * Locate the `.dsh-scope.json` that governs one Session.
 *
 * DSH keeps two directories per Session: the immutable header `cwd` (the
 * original project, which also bounds sandbox writes) and the
 * `workingDirectory` projection (the effective directory, advanced by
 * `working-directory/change`). A subagent started with `cwd` keeps its
 * parent's header and receives the requested directory only in the
 * projection. DSH core reads per-folder configuration (instruction files,
 * Skill catalog, tools) from the projection, so this plugin does too, while
 * the header stays the upper bound of the search.
 */
import type {
  FsServiceLike,
  ScopeLocation,
  SessionLike,
  WorkingDirectoryLike,
} from "./types.js";

export const CONFIG_FILE = ".dsh-scope.json";

const WINDOWS_DRIVE_ROOT = /^([A-Za-z]):(?:[\\/]|$)/;
const WINDOWS_UNC_ROOT = /^\\\\([^\\/]+)[\\/]+([^\\/]+)(?:[\\/]|$)/;

interface ParsedPath {
  root: string;
  segments: string[];
  windows: boolean;
}

/**
 * Split an absolute path into its root and lexically normalized segments.
 * Supports POSIX paths and Windows drive or UNC paths.
 * @returns undefined for relative, empty or malformed input.
 */
function parseAbsolutePath(path: string | undefined): ParsedPath | undefined {
  if (typeof path !== "string" || path === "" || path.includes("\0")) return undefined;
  let root: string;
  let rest: string;
  let windows = false;
  const drive = WINDOWS_DRIVE_ROOT.exec(path);
  const unc = drive === null ? WINDOWS_UNC_ROOT.exec(path) : null;
  if (drive !== null) {
    windows = true;
    root = `${drive[1]!.toUpperCase()}:\\`;
    rest = path.slice(drive[0].length);
  } else if (unc !== null) {
    windows = true;
    root = `\\\\${unc[1]}\\${unc[2]}\\`;
    rest = path.slice(unc[0].length);
  } else if (path.startsWith("/")) {
    root = "/";
    rest = path.slice(1);
  } else {
    return undefined;
  }
  const segments: string[] = [];
  for (const part of rest.split(windows ? /[\\/]+/ : /\/+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return { root, segments, windows };
}

function formatPath(parsed: ParsedPath, count: number): string {
  return parsed.root + parsed.segments.slice(0, count).join(parsed.windows ? "\\" : "/");
}

function sameName(a: string, b: string, windows: boolean): boolean {
  // Windows path APIs compare names case-insensitively; POSIX does not.
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function startsWithSegments(base: ParsedPath, candidate: ParsedPath): boolean {
  if (base.windows !== candidate.windows) return false;
  if (!sameName(base.root, candidate.root, base.windows)) return false;
  if (candidate.segments.length < base.segments.length) return false;
  return base.segments.every((segment, index) =>
    sameName(segment, candidate.segments[index]!, base.windows));
}

/**
 * Whether `candidatePath` equals `basePath` or lies below it. The comparison
 * is made segment by segment, never as a string prefix: `/ws2` is not inside `/ws`.
 */
export function isPathWithin(basePath: string, candidatePath: string): boolean {
  const base = parseAbsolutePath(basePath);
  const candidate = parseAbsolutePath(candidatePath);
  return base !== undefined && candidate !== undefined && startsWithSegments(base, candidate);
}

/**
 * Directories searched for `.dsh-scope.json`, nearest first.
 * - effective directory inside the boundary: every directory from the
 *   effective directory up to and including the boundary;
 * - effective directory outside the boundary or unusable: the boundary only;
 * - unusable boundary: nothing.
 * @param boundaryPath - canonical header cwd, the inclusive upper bound.
 * @param effectivePath - the Session's effective working directory.
 * @returns absolute directories; when not empty, the last entry is the boundary.
 */
export function scopeSearchDirs(
  boundaryPath: string,
  effectivePath: string | undefined,
): string[] {
  const boundary = parseAbsolutePath(boundaryPath);
  if (boundary === undefined) return [];
  const effective = parseAbsolutePath(effectivePath);
  if (effective === undefined || !startsWithSegments(boundary, effective)) {
    return [formatPath(boundary, boundary.segments.length)];
  }
  const dirs: string[] = [];
  for (let count = effective.segments.length; count >= boundary.segments.length; count -= 1) {
    dirs.push(formatPath(effective, count));
  }
  return dirs;
}

function scopeFilePath(dir: string): string {
  const parsed = parseAbsolutePath(dir)!;
  const separator = parsed.windows ? "\\" : "/";
  const base = formatPath(parsed, parsed.segments.length);
  return base.endsWith(separator) ? base + CONFIG_FILE : base + separator + CONFIG_FILE;
}

/**
 * The Session's effective working directory, read where DSH's own readers
 * (tool-skill, agent-instructions) read it. Falls back to the header cwd when
 * the `workingDirectory` service is missing or its read fails.
 * @param getWorkingDirectory - soft service lookup, evaluated on every call.
 * @param session - the Session, or undefined when no Agent is live.
 */
export function effectiveCwdOf(
  getWorkingDirectory: () => WorkingDirectoryLike | undefined,
  session: SessionLike | undefined,
): string | undefined {
  if (session === undefined) return undefined;
  try {
    const current = getWorkingDirectory()?.get(session);
    if (typeof current === "string" && current !== "") return current;
  } catch {
    // A failing projection read is treated like a missing service.
  }
  const headerCwd = session.header?.cwd;
  return typeof headerCwd === "string" && headerCwd !== "" ? headerCwd : undefined;
}

export interface ScopeResolver {
  locate(session: SessionLike | undefined, signal?: AbortSignal): Promise<ScopeLocation>;
}

/**
 * Rule (nearest file wins):
 * 1. start at the effective working directory (header cwd without the service);
 * 2. walk upward to the first `.dsh-scope.json`;
 * 3. stop at the header cwd, inclusive, never above it;
 * 4. an effective directory outside the header subtree consults only
 *    `<header cwd>/.dsh-scope.json`;
 * 5. nothing found: the location of a new file at the header cwd.
 *
 * The header cwd is canonicalized through the fs service first: DSH stores the
 * header as requested, but commits `working-directory/change` values as
 * `fs.processPath()` realpaths. A scope file that is a symbolic link is read
 * only when its target stays inside the header cwd, and is never written through.
 */
export function createScopeResolver(
  fs: FsServiceLike,
  getWorkingDirectory: () => WorkingDirectoryLike | undefined,
): ScopeResolver {
  async function kindOf(
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<"file" | "symlink" | "absent" | "other"> {
    const info = await fs.lstat(path, undefined, signal);
    if (info === undefined || info === null) return "absent";
    return info.type === "file" || info.type === "symlink" ? info.type : "other";
  }

  async function locate(
    session: SessionLike | undefined,
    signal?: AbortSignal,
  ): Promise<ScopeLocation> {
    const headerCwd = session?.header?.cwd;
    const effectiveCwd = effectiveCwdOf(getWorkingDirectory, session);
    const unlocated: ScopeLocation = { exists: false, writable: false };
    if (typeof headerCwd !== "string" || headerCwd === "") return unlocated;

    const options = signal === undefined ? undefined : { signal };
    const boundaryTarget = await fs.resolve(headerCwd, options);
    const boundaryPath = fs.processPath(boundaryTarget);
    // Projection values other than the raw header are already canonical.
    const effectivePath =
      effectiveCwd === undefined || effectiveCwd === headerCwd ? boundaryPath : effectiveCwd;

    const dirs = scopeSearchDirs(boundaryPath, effectivePath);
    if (dirs.length === 0) return unlocated;

    let boundaryKind: "file" | "symlink" | "absent" | "other" = "absent";
    for (const [index, dir] of dirs.entries()) {
      const path = scopeFilePath(dir);
      const kind = await kindOf(path, signal);
      if (index === dirs.length - 1) boundaryKind = kind;
      if (kind !== "file" && kind !== "symlink") continue;
      const target = await fs.resolve(path, options);
      // A link that leaves the workspace is skipped, never read.
      if (!fs.contains(boundaryTarget, target)) continue;
      return { path, target, exists: true, writable: kind === "file" };
    }

    // Nothing found: a new scope file is created at the header cwd. A link,
    // directory or skipped file there is never written through.
    const path = scopeFilePath(dirs[dirs.length - 1]!);
    if (boundaryKind !== "absent") return { path, exists: false, writable: false };
    const target = await fs.resolve(path, options);
    return { path, target, exists: false, writable: fs.contains(boundaryTarget, target) };
  }

  return { locate };
}
