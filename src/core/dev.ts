// `simien dev`: the Convex-style loop. Nothing is synced by hand.
//
// - schema.ts saved → plan against the database → guards → DDL + pg_zega tracking, all in one
//   transaction → regenerate simien/_generated.
// - The database changed directly (psql, a migration tool) → schema.ts is rewritten from it, which
//   then syncs like any other save.
// - Anything that would break a table or orphan data stops with an error and changes nothing.

import { existsSync, readFileSync, watch } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

import * as stdio from '@zegadb/stdio'

import pkg from '../../package.json'
import { showLogo, startBanner } from '../banner'
import { writeIfChanged, writeSchemaTypes } from '../generated'
import { apply, catalog, connect, installNotifier, onSchemaChange, ready, GuardError } from '../db'
import { event, explain, SimienError, type Globals } from '../output'
import { findProject, type Project } from '../project'
import { plan, pull } from '../schema'
import { start } from '../stack'

export interface DevOptions {
  once?: boolean
}

export interface SyncOutcome {
  changes: string[]
  warnings: string[]
  generated: boolean
}

/** One sync: schema.ts → database → generated code. Throws on a mistake or a guard. */
export async function syncOnce(project: Project, sql: ReturnType<typeof connect>): Promise<SyncOutcome> {
  if (!existsSync(project.schemaFile)) throw new SimienError('simien/schema.ts is missing', { file: project.schemaFile })
  const text = readFileSync(project.schemaFile, 'utf8')
  const result = await plan(text, await catalog(sql), relative(project.root, project.schemaFile))
  if (result.plan.statements.length > 0) await apply(sql, result.plan)
  writeSchemaTypes(project)
  const generated = writeIfChanged(join(project.generatedDir, 'dataModel.ts'), result.dataModel)
  return { changes: result.plan.changes, warnings: result.plan.warnings, generated }
}

export async function dev(globals: Globals, options: DevOptions): Promise<void> {
  const project = findProject()
  const schemaPath = relative(project.root, project.schemaFile)
  event({ event: 'starting', postgres: project.config.ports.postgres, zega: project.config.ports.zega }, globals, () => stdio.log('start', 'Postgres + pg_zega and Zega…'))
  await start(project)
  await ready(project)
  const sql = connect(project)

  const report = (outcome: SyncOutcome) => {
    for (const warning of outcome.warnings) event({ event: 'warning', message: warning }, globals, () => stdio.warn('sync', warning))
    if (outcome.changes.length > 0) {
      event({ event: 'synced', changes: outcome.changes }, globals, () => {
        stdio.success('synced')
        for (const change of outcome.changes) stdio.detail(change)
      })
    } else {
      event({ event: 'unchanged' }, globals, () => stdio.status('sync', 'database matches schema.ts', true))
    }
  }

  if (options.once) {
    try {
      report(await syncOnce(project, sql))
    } finally {
      await sql.end({ timeout: 2 })
    }
    return
  }

  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    const details = error instanceof SimienError ? error.details : {}
    const kind = error instanceof GuardError ? 'blocked' : 'error'
    event({ event: kind, message, ...details }, globals, () => explain(kind, message, typeof details.line === 'number' ? { file: schemaPath, ...details } : details))
  }

  // One sync at a time; saves that land while one runs collapse into a single follow-up.
  let running: Promise<void> | null = null
  let again = false
  const sync = () => {
    if (running) {
      again = true
      return
    }
    running = syncOnce(project, sql).then(report, fail).finally(() => {
      running = null
      if (again) {
        again = false
        sync()
      }
    })
  }

  // A direct change in the database: write schema.ts from it when they now disagree.
  const fromDatabase = async (tag: string) => {
    try {
      const current = await catalog(sql)
      const text = existsSync(project.schemaFile) ? readFileSync(project.schemaFile, 'utf8') : ''
      const differs = await plan(text, current, schemaPath).then((r) => r.plan.statements.length > 0, () => true)
      if (!differs) return
      const pulled = await pull(current)
      writeIfChanged(project.schemaFile, pulled.schemaTs)
      writeIfChanged(join(project.generatedDir, 'dataModel.ts'), pulled.dataModel)
      event({ event: 'pulled', from: tag, file: schemaPath }, globals, () => stdio.log('pull', `${schemaPath} rewritten from a database change (${tag})`))
      for (const table of pulled.unmanaged) {
        event({ event: 'warning', message: `${table.table} isn't a Simien table: ${table.reason}` }, globals, () => stdio.warn(table.table, `isn't a Simien table: ${table.reason}`))
      }
    } catch (error) {
      fail(error)
    }
  }

  await installNotifier(sql)
  await onSchemaChange(sql, (tag) => void fromDatabase(tag))
  sync()
  await running

  let timer: ReturnType<typeof setTimeout> | null = null
  watch(dirname(project.schemaFile), (_kind, name) => {
    if (name !== basename(project.schemaFile)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(sync, 100)
  })
  event({ event: 'watching', file: schemaPath }, globals, () =>
    showLogo(globals.human)
      ? process.stdout.write(startBanner({
          version: pkg.version,
          tagline: 'Postgres + Zega, in sync with your schema',
          color: true,
          lines: [
            { label: 'Postgres', value: `postgres://postgres@127.0.0.1:${project.config.ports.postgres}/postgres` },
            { label: 'Zega', value: `http://127.0.0.1:${project.config.ports.zega}` },
            { label: 'Schema', value: `${schemaPath} (watching; Ctrl+C to stop)` },
            { label: 'Types', value: relative(project.root, join(project.generatedDir, 'dataModel.ts')) },
          ],
        }) + '\n')
      : stdio.log('watch', `${schemaPath} (Ctrl+C to stop)`),
  )
  await new Promise(() => {})
}
