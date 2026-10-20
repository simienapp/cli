// `simien container ...`: the project's Postgres + Zega containers.

import type { ServiceStatus } from 'kebele'

import { event, result, SimienError, type Globals } from '../output'
import { findProject } from '../project'
import * as stack from '../stack'

const show = (s: stack.StackStatus) =>
  `postgres ${s.postgres.ready ? 'ready' : 'down'}  ${s.postgres.url}\nzega     ${s.zega.ready ? 'ready' : 'down'}  ${s.zega.url}`

const row = (service: ServiceStatus) =>
  `  ${service.service.padEnd(9)} ${(service.health ?? service.state).padEnd(10)} ${service.ports.map((p) => `${p.host}→${p.container}`).join(' ')}  ${service.image}`

export async function ls(globals: Globals): Promise<void> {
  const projects = await stack.all()
  result({ projects }, globals, () =>
    projects.length ? projects.map((p) => `${p.project}\n${p.services.map(row).join('\n')}`).join('\n') : 'no Simien containers on this machine',
  )
}

export async function status(globals: Globals): Promise<void> {
  const project = findProject()
  const [now, containers] = await Promise.all([stack.status(project), stack.containers(project)])
  result({ ok: now.postgres.ready && now.zega.ready, ...now, containers }, globals, () =>
    containers.length ? `${show(now)}\n${containers.map(row).join('\n')}` : 'not running; `simien container start` or `simien dev`',
  )
}

export async function start(globals: Globals): Promise<void> {
  const now = await stack.start(findProject(), {
    onEvent: (e) => event(e, globals, () => ('image' in e ? `pulling ${e.image}` : `${e.event} ${e.service}`)),
  })
  result({ ok: true, ...now }, globals, () => show(now))
}

export async function stop(globals: Globals): Promise<void> {
  const removed = await stack.stop(findProject())
  result({ ok: true, removed }, globals, () => (removed.length ? 'stopped (data kept in Docker volumes)' : 'was not running'))
}

export async function logs(globals: Globals, service: string | undefined, options: { tail?: string; follow?: boolean }): Promise<void> {
  if (service !== undefined && !stack.SERVICES.includes(service as stack.ServiceName)) {
    throw new SimienError(`no container ${service}; use ${stack.SERVICES.join(' or ')}`)
  }
  const tail = options.tail === undefined ? undefined : Number(options.tail)
  for await (const line of stack.logs(findProject(), { service: service as stack.ServiceName | undefined, tail, follow: options.follow })) {
    event({ event: 'log', ...line }, globals, () => `${line.service.padEnd(8)} | ${line.text}`)
  }
}

export async function update(globals: Globals): Promise<void> {
  const done = await stack.update(findProject(), (e) =>
    event(e, globals, () => ('image' in e ? `pulling ${e.image}` : `${e.event} ${String(e.service ?? '')}`)),
  )
  result({ ok: true, ...done }, globals, () =>
    `${done.replaced.length ? `replaced ${done.replaced.join(', ')} (data kept)` : 'already on the newest images'}\n${show(done)}`,
  )
}

export async function reset(globals: Globals, options: { yes?: boolean }): Promise<void> {
  const project = findProject()
  if (!options.yes) {
    throw new SimienError(`this deletes every row in ${project.config.name}'s Postgres and Zega; run again with --yes`)
  }
  const deleted = await stack.reset(project)
  const now = await stack.start(project)
  result({ ok: true, deleted, ...now }, globals, () => `deleted ${deleted.join(', ')}; started empty\n${show(now)}`)
}
