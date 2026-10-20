// A Simien project: the directory with simien.json, its schema, and its local stack's secrets.

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { SimienError } from './output'

export interface Config {
  name: string
  ports: { postgres: number; zega: number }
}

export interface Project {
  root: string
  config: Config
  /** simien/schema.ts */
  schemaFile: string
  /** simien/_generated */
  generatedDir: string
  /** .simien: local secrets and the compose file; never committed. */
  stateDir: string
}

export const CONFIG = 'simien.json'

export function findProject(from = process.cwd()): Project {
  let dir = resolve(from)
  while (!existsSync(join(dir, CONFIG))) {
    const parent = dirname(dir)
    if (parent === dir) throw new SimienError('no simien.json here or above; run `simien init` first')
    dir = parent
  }
  return open(dir)
}

export function open(root: string): Project {
  const config = JSON.parse(readFileSync(join(root, CONFIG), 'utf8')) as Config
  if (!config.name || !config.ports?.postgres || !config.ports?.zega) {
    throw new SimienError(`${CONFIG} needs name and ports.postgres / ports.zega`, { file: join(root, CONFIG) })
  }
  return {
    root,
    config,
    schemaFile: join(root, 'simien', 'schema.ts'),
    generatedDir: join(root, 'simien', '_generated'),
    stateDir: join(root, '.simien'),
  }
}

/** A secret for the local stack, created on first use, readable only by you. */
export function secret(project: Project, name: 'postgres_password' | 'zega_token'): string {
  const file = join(project.stateDir, name)
  if (!existsSync(file)) {
    mkdirSync(project.stateDir, { recursive: true, mode: 0o700 })
    writeFileSync(file, randomBytes(24).toString('hex'), { mode: 0o600 })
    chmodSync(file, 0o600)
  }
  return readFileSync(file, 'utf8').trim()
}

export function databaseUrl(project: Project): string {
  return `postgres://postgres:${secret(project, 'postgres_password')}@127.0.0.1:${project.config.ports.postgres}/postgres`
}
