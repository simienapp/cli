// Agent-first output, like the zega CLI: JSON on stdout by default. With --human, @zegadb/stdio
// prints for people (problems on stderr, the rest on stdout, colour only on a terminal).
// A failure is JSON on stderr (stdio's error with --human) and exit code 1.

import * as stdio from '@zegadb/stdio'

export interface Globals {
  human?: boolean
  nopretty?: boolean
}

/** A command's answer: JSON, or `human` printing it through stdio. */
export function result(value: unknown, globals: Globals, human: () => void): void {
  if (globals.human) human()
  else process.stdout.write(JSON.stringify(value, null, globals.nopretty ? undefined : 2) + '\n')
}

/** One line per event, for long-running commands (`simien dev`). */
export function event(value: { event: string } & Record<string, unknown>, globals: Globals, human: () => void): void {
  if (globals.human) human()
  else process.stdout.write(JSON.stringify(value) + '\n')
}

/** An error the user can act on: what happened, and where (file, line, column) when known. */
export class SimienError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

/** The details of a failure, printed under it with --human. */
export function explain(action: string, message: string, details: Record<string, unknown>): void {
  const where = typeof details.file === 'string' ? `${details.file}${details.line ? `:${details.line}:${details.column}` : ''}: ` : ''
  stdio.error(action, where + message)
  if (Array.isArray(details.blocked)) for (const line of details.blocked) process.stderr.write(`  - ${line}\n`)
}

export function failure(error: unknown, globals: Globals): void {
  const message = error instanceof Error ? error.message : String(error)
  const details = error instanceof SimienError ? error.details : {}
  if (globals.human) explain('error', message, details)
  else process.stderr.write(JSON.stringify({ ok: false, error: { message, ...details } }) + '\n')
}
