import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const AUDIENCE = 'npm:registry.npmjs.org'
const REGISTRY = 'https://registry.npmjs.org'

function fail(message) {
  console.error(`[trusted-publish] ${message}`)
  process.exit(1)
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length < 2) fail('GitHub returned an invalid OIDC token')
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

async function run(command, args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? `signal ${signal}`}`))
    })
  })
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const packageName = packageJson.name
if (!packageName) fail('package.json has no name')

const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
if (!requestUrl || !requestToken) {
  fail('GitHub OIDC request environment is unavailable; check permissions.id-token: write')
}

const oidcUrl = new URL(requestUrl)
oidcUrl.searchParams.set('audience', AUDIENCE)
const oidcResponse = await fetch(oidcUrl, {
  headers: { Authorization: `Bearer ${requestToken}` },
})
if (!oidcResponse.ok) {
  fail(`GitHub OIDC token request failed (${oidcResponse.status})`)
}

const oidcBody = await oidcResponse.json()
const idToken = oidcBody.value
if (!idToken) fail('GitHub OIDC response did not contain a token')

const claims = decodeJwtPayload(idToken)
const workflowRef = claims.job_workflow_ref ?? claims.workflow_ref ?? ''
console.log(
  `[trusted-publish] GitHub OIDC ready: repository=${claims.repository ?? ''} ` +
    `workflow_ref=${workflowRef} ref=${claims.ref ?? ''} event=${claims.event_name ?? ''}`,
)

const exchangeUrl = `${REGISTRY}/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(packageName)}`
const exchangeResponse = await fetch(exchangeUrl, {
  method: 'POST',
  headers: { Authorization: `Bearer ${idToken}` },
})
const exchangeText = await exchangeResponse.text()
if (!exchangeResponse.ok) {
  fail(`npm OIDC exchange failed (${exchangeResponse.status}): ${exchangeText.slice(0, 1000)}`)
}

let exchange
try {
  exchange = JSON.parse(exchangeText)
} catch {
  fail('npm OIDC exchange returned invalid JSON')
}

const npmToken = exchange.token
if (!npmToken) fail('npm OIDC exchange response did not contain a token')
console.log(`::add-mask::${npmToken}`)
console.log(`[trusted-publish] npm OIDC exchange succeeded; expires=${exchange.expires ?? 'unknown'}`)

const npmrc = join(process.env.RUNNER_TEMP ?? process.cwd(), `.npmrc-oidc-${process.pid}`)
await writeFile(
  npmrc,
  `registry=${REGISTRY}/\n//registry.npmjs.org/:_authToken=${npmToken}\n`,
  { mode: 0o600 },
)

const publishEnv = { ...process.env, NPM_CONFIG_USERCONFIG: npmrc }
delete publishEnv.NODE_AUTH_TOKEN

try {
  await run('npm', ['publish', '--provenance'], publishEnv)
} finally {
  await unlink(npmrc).catch(() => {})
}
