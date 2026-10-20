// `simien init`: simien.json, a starter schema, and .simien kept out of git.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import * as stdio from '@zegadb/stdio'

import { result, SimienError, type Globals } from '../output'
import { CONFIG, type Config } from '../project'

export const STARTER = `import { defineEdge, defineSchema, defineTable, v } from "@simien/client/schema"

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
  }),
  posts: defineTable({
    title: v.string(),
    body: v.string(),
  }),
  wrote: defineEdge("users", "posts"),
})
`

export async function init(globals: Globals, options: { name?: string; port?: string; force?: boolean }): Promise<void> {
  const root = resolve('.')
  if (existsSync(join(root, CONFIG)) && !options.force) throw new SimienError(`${CONFIG} already exists here (use --force to overwrite)`)
  const base = options.port ? Number(options.port) : 54330
  if (!Number.isInteger(base) || base < 1024 || base > 65534) throw new SimienError('--port must be a number from 1024 to 65534')
  const name = (options.name ?? basename(root)).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const config: Config = { name, ports: { postgres: base, zega: base + 1 } }
  writeFileSync(join(root, CONFIG), JSON.stringify(config, null, 2) + '\n')
  mkdirSync(join(root, 'simien'), { recursive: true })
  const schema = join(root, 'simien', 'schema.ts')
  if (!existsSync(schema) || options.force) writeFileSync(schema, STARTER)
  const ignore = join(root, '.gitignore')
  const ignored = existsSync(ignore) ? readFileSync(ignore, 'utf8') : ''
  if (!ignored.split('\n').includes('.simien')) appendFileSync(ignore, `${ignored && !ignored.endsWith('\n') ? '\n' : ''}.simien\n`)
  result({ ok: true, name, config: CONFIG, schema: 'simien/schema.ts', ports: config.ports }, globals, () => {
    stdio.success(`created ${CONFIG} and simien/schema.ts for ${name}`)
    stdio.info('Postgres', `:${config.ports.postgres}`)
    stdio.info('Zega', `:${config.ports.zega}`)
    stdio.nextStep('run it', 'simien dev')
  })
}
