import { result, type Globals } from '../output'
import { findProject } from '../project'
import { start as startStack, status as stackStatus, stop as stopStack, type StackStatus } from '../stack'

const show = (s: StackStatus) =>
  `postgres ${s.postgres.ready ? 'ready' : 'down'}  ${s.postgres.url}\nzega     ${s.zega.ready ? 'ready' : 'down'}  ${s.zega.url}`

export async function start(globals: Globals): Promise<void> {
  const now = await startStack(findProject())
  result({ ok: true, ...now }, globals, () => show(now))
}

export async function stop(globals: Globals): Promise<void> {
  await stopStack(findProject())
  result({ ok: true, stopped: true }, globals, () => 'stopped (data kept in Docker volumes)')
}

export async function status(globals: Globals): Promise<void> {
  const now = await stackStatus(findProject())
  result({ ok: now.postgres.ready && now.zega.ready, ...now }, globals, () => show(now))
}
