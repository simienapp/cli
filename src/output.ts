// Agent-first output, like the zega CLI: JSON on stdout by default, readable text with --human.
// A failure is JSON on stderr (text with --human) and exit code 1.

export interface Globals {
  human?: boolean
  nopretty?: boolean
}

export function result(value: unknown, globals: Globals, human: () => string): void {
  if (globals.human) process.stdout.write(human() + '\n')
  else process.stdout.write(JSON.stringify(value, null, globals.nopretty ? undefined : 2) + '\n')
}

/** One line per event, for long-running commands (`simien dev`). */
export function event(value: { event: string } & Record<string, unknown>, globals: Globals, human: () => string): void {
  if (globals.human) process.stdout.write(human() + '\n')
  else process.stdout.write(JSON.stringify(value) + '\n')
}

/** An error the user can act on: what happened, and where (file, line, column) when known. */
export class SimienError extends Error {
  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message)
  }
}

export function failure(error: unknown, globals: Globals): string {
  const message = error instanceof Error ? error.message : String(error)
  const details = error instanceof SimienError ? error.details : {}
  if (globals.human) {
    const where = typeof details.file === 'string' ? `${details.file}${details.line ? `:${details.line}:${details.column}` : ''}: ` : ''
    const blocked = Array.isArray(details.blocked) ? details.blocked.map((line) => `  - ${line}\n`).join('') : ''
    return `error: ${where}${message}\n${blocked}`
  }
  return JSON.stringify({ ok: false, error: { message, ...details } }) + '\n'
}
