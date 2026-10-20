// The local stack, like `supabase start`: Postgres with pg_zega, and Zega, in Docker, one pair per
// project. Data lives in Docker volumes and survives `simien stop`.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SimienError } from './output'
import { answers } from './db'
import { secret, type Project } from './project'

export const IMAGES = { postgres: 'addiscorp/pg_zega:0.1', zega: 'addiscorp/zega:0.2.0' } as const

function composeName(project: Project): string {
  return `simien-${project.config.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
}

function composeFile(project: Project): string {
  const file = join(project.stateDir, 'compose.yml')
  mkdirSync(project.stateDir, { recursive: true, mode: 0o700 })
  // Secrets reach the containers through compose's environment, never through this file.
  writeFileSync(
    file,
    `name: ${composeName(project)}
services:
  zega:
    image: ${IMAGES.zega}
    environment:
      ZEGA_TOKEN: \${ZEGA_TOKEN}
    volumes: [zega:/var/lib/zega]
    ports: ["127.0.0.1:${project.config.ports.zega}:9342"]
  postgres:
    image: ${IMAGES.postgres}
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}
      ZEGA_PASSWORD: \${ZEGA_TOKEN}
      ZEGA_URL: http://zega:9342
    volumes: [postgres:/var/lib/postgresql/data]
    ports: ["127.0.0.1:${project.config.ports.postgres}:5432"]
    depends_on: [zega]
volumes:
  zega:
  postgres:
`,
    { mode: 0o600 },
  )
  return file
}

async function compose(project: Project, args: string[]): Promise<string> {
  const proc = Bun.spawn(['docker', 'compose', '-f', composeFile(project), ...args], {
    cwd: project.root,
    env: { ...process.env, ZEGA_TOKEN: secret(project, 'zega_token'), POSTGRES_PASSWORD: secret(project, 'postgres_password') },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new SimienError(`docker compose ${args[0]} failed: ${err.trim() || out.trim()}`)
  return out
}

export interface StackStatus {
  postgres: { url: string; ready: boolean }
  zega: { url: string; ready: boolean }
}

export async function status(project: Project): Promise<StackStatus> {
  const zegaUrl = `http://127.0.0.1:${project.config.ports.zega}`
  const zega = await fetch(`${zegaUrl}/health`, { headers: { authorization: `Bearer ${secret(project, 'zega_token')}` } })
    .then((response) => response.ok)
    .catch(() => false)
  const postgres = await answers(project)
  return {
    postgres: { url: `postgres://postgres@127.0.0.1:${project.config.ports.postgres}/postgres`, ready: postgres },
    zega: { url: zegaUrl, ready: zega },
  }
}

export async function start(project: Project, timeoutMs = 90_000): Promise<StackStatus> {
  await compose(project, ['up', '-d', '--wait'])
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const now = await status(project)
    if (now.postgres.ready && now.zega.ready) return now
    if (Date.now() > deadline) throw new SimienError('the local stack did not become ready; see `docker compose logs` in .simien')
    await Bun.sleep(500)
  }
}

export async function stop(project: Project): Promise<void> {
  await compose(project, ['down'])
}
