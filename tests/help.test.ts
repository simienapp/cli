// The help and command-line errors: JSON for agents by default, text for people with --human.

import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { program } from '../src/program'

const CLI = join(import.meta.dir, '..', 'src', 'simien.ts')

async function simien(...args: string[]) {
  const proc = Bun.spawn(['bun', CLI, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout, stderr, code }
}

test('`simien` alone is JSON help listing every command, subcommands included', async () => {
  const { stdout, code } = await simien()
  expect(code).toBe(0)
  const help = JSON.parse(stdout)
  const listed = Object.values(help.commands as Record<string, Record<string, unknown>>).flatMap((group) =>
    Object.entries(group).flatMap(([name, value]) => (typeof value === 'string' ? [name] : Object.keys(value as object).map((sub) => `${name} ${sub}`))),
  )
  const defined = program.commands.flatMap((command) =>
    command.commands.length ? command.commands.map((sub) => `${command.name()} ${sub.name()}`) : [command.name()],
  )
  expect(listed.sort()).toEqual(defined.sort())
})

test('--human is text, not JSON', async () => {
  const { stdout, code } = await simien('--human')
  expect(code).toBe(0)
  expect(stdout).toContain('Usage: simien [options] [command]')
  expect(() => JSON.parse(stdout)).toThrow()
})

test('`simien container` alone is its help, on stdout', async () => {
  const { stdout, code } = await simien('container')
  expect(code).toBe(0)
  expect(Object.keys(JSON.parse(stdout).commands)).toEqual(['ls', 'status', 'start', 'stop', 'logs', 'update', 'reset'])
})

test('a mistyped command is a JSON usage error with the suggestion as a field', async () => {
  const { stderr, code } = await simien('contaner', 'ls')
  expect(code).toBe(1)
  expect(JSON.parse(stderr)).toEqual({
    ok: false,
    error: { code: 'usage', message: "unknown command 'contaner'", suggestion: 'container', hint: 'simien --help' },
  })
  expect((await simien('--human', 'contaner')).stderr).toStartWith("error: unknown command 'contaner'")
})
