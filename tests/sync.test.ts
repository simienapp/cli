// End to end against a real local stack (Docker: pg_zega + Zega). Every rule of the sync is
// checked on data in both databases, not on the plan text.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const CLI = join(import.meta.dir, '..', 'src', 'simien.ts')
const root = join(import.meta.dir, '..', '.tmp', `e2e-${process.pid}`)
const schemaFile = join(root, 'simien', 'schema.ts')
let sql: postgres.Sql

async function simien(...args: string[]) {
  const proc = Bun.spawn(['bun', CLI, '--nopretty', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  const lines = stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  return { code, lines, error: stderr.trim() ? JSON.parse(stderr).error : null }
}

const schema = (body: string) =>
  writeFileSync(schemaFile, `import { defineEdge, defineSchema, defineTable, v } from "@simien/client/schema"\n\nexport default defineSchema({\n${body}\n})\n`)

type Graph = { nodes: ({ labels: string[] } & Record<string, unknown>)[]; rels: { type: string }[] }
const graph = async (): Promise<Graph> => (await sql`select zega.read_graph() as g`)[0]!.g
const columns = async (table: string) =>
  (await sql`select column_name from information_schema.columns where table_name = ${table} order by ordinal_position`).map((r) => r.column_name)

beforeAll(async () => {
  mkdirSync(root, { recursive: true })
  expect((await simien('init', '--name', `e2e-${process.pid}`, '--port', '54350')).code).toBe(0)
  const password = () => readFileSync(join(root, '.simien', 'postgres_password'), 'utf8').trim()
  schema(`  users: defineTable({ name: v.string(), email: v.optional(v.string()) }),
  posts: defineTable({ title: v.string() }),
  wrote: defineEdge("users", "posts"),`)
  const first = await simien('dev', '--once')
  expect(first.error).toBeNull()
  expect(first.lines.at(-1)).toEqual({ event: 'synced', changes: ['add table users', 'add table posts', 'add edge wrote (users → posts)'] })
  sql = postgres(`postgres://postgres:${password()}@127.0.0.1:54350/postgres`, { onnotice: () => {} })
  await sql`insert into users (name, email) values ('Nia', 'nia@example.com')`
  await sql`insert into posts (title) values ('Hello')`
  await sql`insert into ze_wrote values (1, 1)`
}, 180_000)

afterAll(async () => {
  await sql?.end({ timeout: 2 })
  const compose = join(root, '.simien', 'compose.yml')
  await Bun.spawn(['docker', 'compose', '-f', compose, 'down', '-v'], { cwd: root, env: { ...process.env, ZEGA_TOKEN: 'x', POSTGRES_PASSWORD: 'x' }, stdout: 'ignore', stderr: 'ignore' }).exited
  rmSync(root, { recursive: true, force: true })
}, 60_000)

test('tables, edges and rows reach Zega, and generated types are written', async () => {
  const now = await graph()
  expect(now.nodes.find((n) => n.labels[0] === 'users')).toMatchObject({ name: 'Nia', email: 'nia@example.com' })
  expect(now.rels.map((r) => r.type)).toEqual(['wrote'])
  expect(readFileSync(join(root, 'simien', '_generated', 'dataModel.ts'), 'utf8')).toContain('export interface Users {')
  expect((await simien('dev', '--once')).lines.at(-1)).toEqual({ event: 'unchanged' })
})

test('removing a field that holds data is a hard error and changes nothing', async () => {
  schema(`  users: defineTable({ name: v.string() }),
  posts: defineTable({ title: v.string() }),
  wrote: defineEdge("users", "posts"),`)
  const run = await simien('dev', '--once')
  expect(run.code).toBe(1)
  expect(run.error.blocked[0]).toContain('users.email still holds data')
  expect(await columns('users')).toEqual(['_id', 'name', 'email'])
})

test('a rename warns, applies at once, and Zega carries the data under the new name', async () => {
  schema(`  users: defineTable({ name: v.string(), contact: v.optional(v.string()) }),
  posts: defineTable({ title: v.string() }),
  wrote: defineEdge("users", "posts"),`)
  const run = await simien('dev', '--once')
  expect(run.lines.find((l) => l.event === 'warning').message).toContain('users.email → users.contact')
  const user = (await graph()).nodes.find((n) => n.labels[0] === 'users')!
  expect(user.contact).toBe('nia@example.com')
  expect('email' in user).toBe(false)
  expect((await graph()).rels.length).toBe(1)
})

test('an empty field is dropped, so no orphan column is left', async () => {
  await sql`update users set contact = null`
  schema(`  users: defineTable({ name: v.string() }),
  posts: defineTable({ title: v.string() }),
  wrote: defineEdge("users", "posts"),`)
  expect((await simien('dev', '--once')).lines.at(-1).changes).toEqual(['remove users.contact'])
  expect(await columns('users')).toEqual(['_id', 'name'])
  // pg_zega 0.1 leaves a value in Zega when Postgres sets it to NULL; the reload clears it.
  expect('contact' in (await graph()).nodes.find((n) => n.labels[0] === 'users')!).toBe(false)
})

test('a new required field on a table with rows is a hard error (widen first)', async () => {
  schema(`  users: defineTable({ name: v.string(), age: v.int() }),
  posts: defineTable({ title: v.string() }),
  wrote: defineEdge("users", "posts"),`)
  const run = await simien('dev', '--once')
  expect(run.code).toBe(1)
  expect(run.error.blocked[0]).toContain('v.optional(...) first')
  expect(await columns('users')).toEqual(['_id', 'name'])
})

test('a table rename keeps rows and edges, and Zega relabels them', async () => {
  schema(`  users: defineTable({ name: v.string() }),
  articles: defineTable({ title: v.string() }),
  wrote: defineEdge("users", "articles"),`)
  const run = await simien('dev', '--once')
  expect(run.lines.find((l) => l.event === 'warning').message).toContain('posts → articles')
  const now = await graph()
  expect(now.nodes.map((n) => n.labels[0]).sort()).toEqual(['articles', 'users'])
  expect(now.rels.length).toBe(1)
})

test('removing a table that has rows is a hard error', async () => {
  schema(`  users: defineTable({ name: v.string() }),`)
  const run = await simien('dev', '--once')
  expect(run.code).toBe(1)
  expect(run.error.blocked.join(' ')).toContain('table articles still has rows')
  expect((await sql`select count(*)::int as n from articles`)[0]!.n).toBe(1)
  schema(`  users: defineTable({ name: v.string() }),
  articles: defineTable({ title: v.string() }),
  wrote: defineEdge("users", "articles"),`)
})

test('a direct change in the database rewrites schema.ts while dev runs', async () => {
  const proc = Bun.spawn(['bun', CLI, 'dev'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const reader = proc.stdout.getReader()
  let seen = ''
  const until = async (word: string) => {
    while (!seen.includes(word)) {
      const { value, done } = await reader.read()
      if (done) throw new Error(`dev exited before "${word}": ${seen}`)
      seen += new TextDecoder().decode(value)
    }
  }
  try {
    await until('"watching"')
    await sql.unsafe('alter table articles add column views bigint')
    await until('"pulled"')
    expect(readFileSync(schemaFile, 'utf8')).toContain('views: v.optional(v.int())')
  } finally {
    proc.kill()
    await proc.exited
  }
}, 60_000)
