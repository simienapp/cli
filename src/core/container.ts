// `simien container ...`: the project's Postgres + Zega containers.

import * as stdio from '@zegadb/stdio'
import type { ServiceStatus, UpEvent } from 'kebele'

import { event, result, SimienError, type Globals } from '../output'
import { findProject } from '../project'
import * as stack from '../stack'

function showStatus(s: stack.StackStatus): void {
  stdio.status('postgres', s.postgres.url, s.postgres.ready)
  stdio.status('zega', s.zega.url, s.zega.ready)
}

function showContainers(services: ServiceStatus[]): void {
  for (const service of services) {
    const ports = service.ports.map((p) => `${p.host}→${p.container}`).join(' ')
    stdio.info(service.service, `${(service.health ?? service.state).padEnd(10)} ${ports.padEnd(12)} ${service.image}`)
  }
}

const progress = (e: UpEvent | { event: string; [key: string]: unknown }) =>
  'image' in e ? stdio.log('pull', String(e.image)) : stdio.log(e.event, String(e.service ?? ''))

export async function ls(globals: Globals): Promise<void> {
  const projects = await stack.all()
  result({ projects }, globals, () => {
    if (projects.length === 0) return stdio.hint('no Simien containers on this machine')
    for (const project of projects) {
      stdio.header(project.project)
      showContainers(project.services)
    }
  })
}

export async function status(globals: Globals): Promise<void> {
  const project = findProject()
  const [now, containers] = await Promise.all([stack.status(project), stack.containers(project)])
  result({ ok: now.postgres.ready && now.zega.ready, ...now, containers }, globals, () => {
    if (containers.length === 0) {
      stdio.status(project.config.name, 'not running', false)
      return stdio.nextStep('start it', 'simien dev')
    }
    showStatus(now)
    showContainers(containers)
  })
}

export async function start(globals: Globals): Promise<void> {
  const now = await stack.start(findProject(), { onEvent: (e) => event(e, globals, () => progress(e)) })
  result({ ok: true, ...now }, globals, () => showStatus(now))
}

export async function stop(globals: Globals): Promise<void> {
  const removed = await stack.stop(findProject())
  result({ ok: true, removed }, globals, () =>
    removed.length ? stdio.success('stopped; data kept in Docker volumes') : stdio.hint('was not running'),
  )
}

export async function logs(globals: Globals, service: string | undefined, options: { tail?: string; follow?: boolean }): Promise<void> {
  if (service !== undefined && !stack.SERVICES.includes(service as stack.ServiceName)) {
    throw new SimienError(`no container ${service}; use ${stack.SERVICES.join(' or ')}`)
  }
  const tail = options.tail === undefined ? undefined : Number(options.tail)
  for await (const line of stack.logs(findProject(), { service: service as stack.ServiceName | undefined, tail, follow: options.follow })) {
    // The containers' own text, unchanged, under the service's name.
    event({ event: 'log', ...line }, globals, () => stdio.log(line.service, line.text))
  }
}

export async function update(globals: Globals): Promise<void> {
  const done = await stack.update(findProject(), (e) => event(e, globals, () => progress(e)))
  result({ ok: true, ...done }, globals, () => {
    if (done.replaced.length) stdio.success(`replaced ${done.replaced.join(', ')}; data kept`)
    else stdio.success('already on the newest images')
    showStatus(done)
  })
}

export async function reset(globals: Globals, options: { yes?: boolean }): Promise<void> {
  const project = findProject()
  if (!options.yes) {
    throw new SimienError(`this deletes every row in ${project.config.name}'s Postgres and Zega; run again with --yes`)
  }
  const deleted = await stack.reset(project)
  const now = await stack.start(project)
  result({ ok: true, deleted, ...now }, globals, () => {
    stdio.success(`deleted ${deleted.join(', ')}; started empty`)
    showStatus(now)
  })
}
