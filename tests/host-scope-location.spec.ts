/**
 * Host-half scope file location: the pure path rules and the resolver against
 * an in-memory filesystem with DSH fs semantics (resolve() realpaths, lstat()
 * does not follow a final symbolic link).
 */
import { describe, expect, it } from 'vitest'
import {
  createScopeResolver,
  effectiveCwdOf,
  isPathWithin,
  scopeSearchDirs,
} from '../src/index'

const WS = '/dev/ws'
const AUDIO = `${WS}/scenarios/audio`

type Entry = { file: string } | { link: string } | { dir: true }

function memoryFs(layout: Record<string, Entry>) {
  const nodes = new Map<string, Entry>([['/', { dir: true }]])
  const touched: string[] = []
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
  const join = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`)
  for (const [path, entry] of Object.entries(layout)) {
    for (let dir = parentOf(path); !nodes.has(dir); dir = parentOf(dir)) nodes.set(dir, { dir: true })
    nodes.set(path, entry)
  }
  // Follows every symbolic link; a missing tail keeps its lexical spelling.
  const realpath = (path: string): string => {
    let current = '/'
    const parts = path.split('/').filter(Boolean)
    for (const [index, part] of parts.entries()) {
      let next = join(current, part)
      let node = nodes.get(next)
      for (let hops = 0; node !== undefined && 'link' in node && hops < 8; hops += 1) {
        next = node.link
        node = nodes.get(next)
      }
      if (node === undefined) return [next, ...parts.slice(index + 1)].join('/')
      current = next
    }
    return current
  }
  const fs = {
    resolve: async (path: string) => {
      touched.push(path)
      return realpath(path)
    },
    processPath: (target: unknown) => String(target),
    contains: (parent: unknown, child: unknown) =>
      child === parent || String(child).startsWith(`${String(parent)}/`),
    lstat: async (path: string) => {
      touched.push(path)
      const node = nodes.get(join(realpath(parentOf(path)), path.slice(path.lastIndexOf('/') + 1)))
      if (node === undefined) return undefined
      return { type: 'file' in node ? 'file' as const : 'link' in node ? 'symlink' as const : 'directory' as const }
    },
    readText: async (target: unknown) => {
      touched.push(String(target))
      const node = nodes.get(String(target))
      if (node === undefined || !('file' in node)) throw new Error('FS_NOT_FOUND')
      return node.file
    },
    writeText: async () => undefined,
  }
  return { fs, touched }
}

const LAYOUT: Record<string, Entry> = {
  '/dev/.dsh-scope.json': { file: 'above the workspace' },
  '/dev/ws2/.dsh-scope.json': { file: 'prefix look-alike' },
  '/dev/secret.json': { file: 'outside' },
  [`${WS}/.dsh-scope.json`]: { file: 'root' },
  [`${AUDIO}/.dsh-scope.json`]: { file: 'audio' },
  [`${AUDIO}/notes`]: { dir: true },
  [`${WS}/scenarios/new`]: { dir: true },
  [`${WS}/scenarios/escape/.dsh-scope.json`]: { link: '/dev/secret.json' },
  [`${WS}/scenarios/shared/.dsh-scope.json`]: { link: `${AUDIO}/.dsh-scope.json` },
  '/dev/ws-link': { link: WS },
}

function sessionIn(header: string, effective?: string) {
  const session = { header: { cwd: header } }
  const service = effective === undefined ? undefined : { get: () => effective }
  return { session, getWorkingDirectory: () => service }
}

const outside = (touched: string[], root: string) =>
  touched.filter((path) => path !== root && !path.startsWith(`${root}/`))

describe('scope path rules', () => {
  it('compares paths by segment, never by string prefix', () => {
    expect(isPathWithin(WS, '/dev/ws2')).toBe(false)
    expect(isPathWithin(WS, WS)).toBe(true)
    expect(isPathWithin(WS, `${WS}/`)).toBe(true)
    expect(isPathWithin(WS, AUDIO)).toBe(true)
    expect(isPathWithin(WS, `${AUDIO}/../../../other`)).toBe(false)
    expect(isPathWithin(WS, 'scenarios/audio')).toBe(false)
  })

  it('lists directories from the effective cwd up to the header cwd, nearest first', () => {
    expect(scopeSearchDirs(WS, `${AUDIO}/notes`)).toEqual([
      `${AUDIO}/notes`,
      AUDIO,
      `${WS}/scenarios`,
      WS,
    ])
    expect(scopeSearchDirs(WS, WS)).toEqual([WS])
  })

  it('searches only the header cwd when the effective cwd lies outside it', () => {
    expect(scopeSearchDirs(WS, '/dev/other')).toEqual([WS])
    expect(scopeSearchDirs(WS, '/dev/ws2/x')).toEqual([WS])
    expect(scopeSearchDirs(WS, undefined)).toEqual([WS])
    expect(scopeSearchDirs('relative/path', AUDIO)).toEqual([])
  })

  it('handles Windows drive and UNC paths case-insensitively', () => {
    expect(isPathWithin('C:\\Users\\A\\ws', 'c:/users/a/ws/scenarios')).toBe(true)
    expect(isPathWithin('C:\\Users\\A\\ws', 'C:\\Users\\A\\ws2')).toBe(false)
    expect(isPathWithin('C:\\ws', 'D:\\ws')).toBe(false)
    expect(scopeSearchDirs('C:\\ws', 'C:\\ws\\a\\b')).toEqual(['C:\\ws\\a\\b', 'C:\\ws\\a', 'C:\\ws'])
    expect(isPathWithin('\\\\server\\share\\ws', '\\\\server\\share\\ws\\a')).toBe(true)
  })

  it('reads the effective cwd from the workingDirectory service, else the header cwd', () => {
    const session = { header: { cwd: WS } }
    expect(effectiveCwdOf(() => ({ get: () => AUDIO }), session)).toBe(AUDIO)
    expect(effectiveCwdOf(() => undefined, session)).toBe(WS)
    expect(effectiveCwdOf(() => ({ get: () => { throw new Error('not ready') } }), session)).toBe(WS)
    expect(effectiveCwdOf(() => ({ get: () => '' }), session)).toBe(WS)
    expect(effectiveCwdOf(() => undefined, undefined)).toBeUndefined()
  })
})

describe('createScopeResolver', () => {
  it('resolves the scope file of the effective cwd, not of the header cwd', async () => {
    const { fs } = memoryFs(LAYOUT)
    const { session, getWorkingDirectory } = sessionIn(WS, AUDIO)
    await expect(createScopeResolver(fs, getWorkingDirectory).locate(session)).resolves.toMatchObject({
      path: `${AUDIO}/.dsh-scope.json`,
      exists: true,
      writable: true,
    })
  })

  it('walks up to the nearest scope file and stops at the header cwd', async () => {
    const { fs, touched } = memoryFs(LAYOUT)
    const notes = sessionIn(WS, `${AUDIO}/notes`)
    expect((await createScopeResolver(fs, notes.getWorkingDirectory).locate(notes.session)).path)
      .toBe(`${AUDIO}/.dsh-scope.json`)
    expect(touched).not.toContain(`${WS}/.dsh-scope.json`)

    const nested = sessionIn(`${WS}/scenarios`, `${WS}/scenarios/new`)
    await expect(createScopeResolver(fs, nested.getWorkingDirectory).locate(nested.session))
      .resolves.toMatchObject({ path: `${WS}/scenarios/.dsh-scope.json`, exists: false, writable: true })
    expect(outside(touched, WS)).toEqual([])
  })

  it('reads only the header file when the effective cwd lies outside the workspace', async () => {
    const { fs, touched } = memoryFs(LAYOUT)
    for (const effective of ['/dev/other', '/dev/ws2']) {
      const { session, getWorkingDirectory } = sessionIn(WS, effective)
      expect((await createScopeResolver(fs, getWorkingDirectory).locate(session)).path)
        .toBe(`${WS}/.dsh-scope.json`)
    }
    expect(outside(touched, WS)).toEqual([])
  })

  it('canonicalizes a symlinked header cwd before comparing it with the projection', async () => {
    const { fs } = memoryFs(LAYOUT)
    // DSH stores the header as requested but commits the projection as a realpath.
    const { session, getWorkingDirectory } = sessionIn('/dev/ws-link', AUDIO)
    expect((await createScopeResolver(fs, getWorkingDirectory).locate(session)).path)
      .toBe(`${AUDIO}/.dsh-scope.json`)
  })

  it('falls back to the header cwd without a workingDirectory service', async () => {
    const { fs } = memoryFs(LAYOUT)
    const { session } = sessionIn(WS)
    expect((await createScopeResolver(fs, () => undefined).locate(session)).path)
      .toBe(`${WS}/.dsh-scope.json`)
  })

  it('skips a scope file that links outside the workspace', async () => {
    const { fs, touched } = memoryFs(LAYOUT)
    const { session, getWorkingDirectory } = sessionIn(WS, `${WS}/scenarios/escape`)
    expect((await createScopeResolver(fs, getWorkingDirectory).locate(session)).path)
      .toBe(`${WS}/.dsh-scope.json`)
    expect(touched).not.toContain('/dev/secret.json')
  })

  it('reads a scope file that links inside the workspace, but never writes through it', async () => {
    const { fs } = memoryFs(LAYOUT)
    const { session, getWorkingDirectory } = sessionIn(WS, `${WS}/scenarios/shared`)
    await expect(createScopeResolver(fs, getWorkingDirectory).locate(session)).resolves.toMatchObject({
      path: `${WS}/scenarios/shared/.dsh-scope.json`,
      target: `${AUDIO}/.dsh-scope.json`,
      exists: true,
      writable: false,
    })
  })

  it('does not offer a new file at the header cwd when a link occupies that path', async () => {
    const { fs } = memoryFs(LAYOUT)
    const { session } = sessionIn(`${WS}/scenarios/escape`)
    await expect(createScopeResolver(fs, () => undefined).locate(session)).resolves.toEqual({
      path: `${WS}/scenarios/escape/.dsh-scope.json`,
      exists: false,
      writable: false,
    })
  })

  it('returns no location for a session without a header cwd', async () => {
    const { fs } = memoryFs(LAYOUT)
    await expect(createScopeResolver(fs, () => undefined).locate(undefined))
      .resolves.toEqual({ exists: false, writable: false })
  })
})
