// The local stack, like `supabase start`: Postgres with pg_zega, and Zega, in Docker, one pair per
// project. kebele runs the containers; data lives in Docker volumes and survives `stop`.

import { Docker, down, list, logs as stackLogs, status as kebeleStatus, up, type ServiceStatus, type Stack, type UpEvent } from 'kebele'

import { answers } from './db'
import { SimienError } from './output'
import { secret, type Project } from './project'

export const IMAGES = { postgres: 'addiscorp/pg_zega:0.1', zega: 'addiscorp/zega:0.2.0' } as const
export const SERVICES = ['postgres', 'zega'] as const
export type ServiceName = (typeof SERVICES)[number]

/** Every Simien project's stack is a kebele stack named `simien-<project>`. */
const PREFIX = 'simien-'

export function stackName(project: Project): string {
  return PREFIX + project.config.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
}

/** The stack, with secrets passed to Docker directly; nothing is written to disk but the secrets themselves. */
export function describe(project: Project): Stack {
  const token = secret(project, 'zega_token')
  return {
    name: stackName(project),
    services: {
      zega: {
        image: IMAGES.zega,
        env: { ZEGA_TOKEN: token },
        ports: [{ host: project.config.ports.zega, container: 9342 }],
        volumes: [{ volume: 'zega', path: '/var/lib/zega' }],
      },
      postgres: {
        image: IMAGES.postgres,
        env: { POSTGRES_PASSWORD: secret(project, 'postgres_password'), ZEGA_PASSWORD: token, ZEGA_URL: 'http://zega:9342' },
        ports: [{ host: project.config.ports.postgres, container: 5432 }],
        volumes: [{ volume: 'postgres', path: '/var/lib/postgresql/data' }],
        health: { command: ['pg_isready', '-U', 'postgres'] },
        dependsOn: ['zega'],
      },
    },
  }
}

let client: Docker | undefined
const docker = () => (client ??= new Docker())

export interface StackStatus {
  postgres: { url: string; ready: boolean }
  zega: { url: string; ready: boolean }
}

/** Whether each database answers, which is more than Docker knowing the container runs. */
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

/** The containers as Docker sees them: state, health, ports. */
export async function containers(project: Project): Promise<ServiceStatus[]> {
  return (await kebeleStatus(docker(), stackName(project))).services
}

/** Every Simien project's containers on this machine. */
export async function all(): Promise<{ project: string; services: ServiceStatus[] }[]> {
  return (await list(docker()))
    .filter((stack) => stack.name.startsWith(PREFIX))
    .map((stack) => ({ project: stack.name.slice(PREFIX.length), services: stack.services }))
}

export async function start(project: Project, options: { onEvent?: (event: UpEvent) => void; timeoutMs?: number } = {}): Promise<StackStatus> {
  const timeoutMs = options.timeoutMs ?? 120_000
  await up(docker(), describe(project), { onEvent: options.onEvent, timeoutMs })
  // Zega has no health check inside its image; ask it over HTTP, and Postgres with a real query.
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const now = await status(project)
    if (now.postgres.ready && now.zega.ready) return now
    if (Date.now() > deadline) throw new SimienError('the local stack did not become ready; see `simien container logs`', { ...now })
    await Bun.sleep(250)
  }
}

export async function stop(project: Project): Promise<string[]> {
  return (await down(docker(), stackName(project))).removed
}

/** Delete the project's containers and data. */
export async function reset(project: Project): Promise<string[]> {
  return (await down(docker(), describe(project), { volumes: true })).volumes
}

export function logs(project: Project, options: { service?: ServiceName; tail?: number; follow?: boolean }) {
  return stackLogs(docker(), stackName(project), options)
}

/**
 * Pull the images this CLI pins, and replace any container still running older bytes. Volumes,
 * and the data in them, stay.
 */
export async function update(project: Project, onEvent: (event: { event: string; [key: string]: unknown }) => void = () => {}) {
  const client = docker()
  const replaced: ServiceName[] = []
  for (const service of SERVICES) {
    const image = IMAGES[service]
    onEvent({ event: 'pull', image })
    await client.pull(image)
    const latest = (await (await client.request('GET', `/images/${encodeURIComponent(image)}/json`)).json()) as { Id: string }
    const name = `${stackName(project)}-${service}`
    const running = await client.request('GET', `/containers/${encodeURIComponent(name)}/json`, { ok: [200, 404] })
    const current = running.status === 200 ? ((await running.json()) as { Image: string }).Image : undefined
    if (running.status === 404) await running.body?.cancel()
    if (current !== undefined && current !== latest.Id) {
      await client.remove(name)
      replaced.push(service)
    }
  }
  const now = await start(project, { onEvent })
  return { replaced, images: IMAGES, ...now }
}
