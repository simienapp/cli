// `simien check` through the real simien-check binary (bun run build:check).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CLI = join(import.meta.dir, '..', 'src', 'simien.ts')
const BINARY = join(import.meta.dir, '..', '.target', 'release', 'simien-check')
const root = join(import.meta.dir, '..', '.tmp', `check-${process.pid}`)

async function simien(...args: string[]) {
  const proc = Bun.spawn(['bun', CLI, '--nopretty', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, stdout, stderr }
}

beforeAll(async () => {
  if (!existsSync(BINARY)) throw new Error('simien-check is not built: run `bun run build:check` first')
  mkdirSync(root, { recursive: true })
  expect((await simien('init', '--name', 'check', '--port', '54390')).code).toBe(0)
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

test('a fresh project type-checks, schema.ts included', async () => {
  const run = await simien('check')
  expect(run.code).toBe(0)
  expect(JSON.parse(run.stdout)).toEqual({ ok: true, files: 2, diagnostics: [] })
})

test('a type error is reported with its file, position and code, and exits 1', async () => {
  writeFileSync(join(root, 'simien', 'app.ts'), 'interface User { age: number }\nexport const u: User = { age: "ten" }\n')
  const run = await simien('check')
  expect(run.code).toBe(1)
  const report = JSON.parse(run.stdout)
  expect(report.ok).toBe(false)
  expect(report.diagnostics).toEqual([
    {
      file: 'simien/app.ts',
      line: 2,
      column: 26,
      code: 2322,
      category: 'error',
      message: "Type 'string' is not assignable to type 'number'.",
    },
  ])
  rmSync(join(root, 'simien', 'app.ts'))
})

test("the generated schema types catch mistakes in schema.ts's own language", async () => {
  writeFileSync(
    join(root, 'simien', 'schema.ts'),
    'import { defineSchema, defineTable, v } from "@simien/client/schema"\n\nexport default defineSchema({\n  users: defineTable({ name: v.strin() }),\n})\n',
  )
  const report = JSON.parse((await simien('check')).stdout)
  expect(report.diagnostics.map((d: { file: string; line: number; code: number }) => [d.file, d.line, d.code])).toEqual([['simien/schema.ts', 4, 2551]])
  expect(report.diagnostics[0].message).toContain("Did you mean 'string'?")
})

test('--human prints each error and a summary', async () => {
  const run = await simien('--human', 'check')
  expect(run.code).toBe(1)
  expect(run.stderr).toContain('simien/schema.ts:4:')
  expect(run.stderr).toContain('1 type error')
})
