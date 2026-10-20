import { Command } from 'commander'

import pkg from '../package.json'
import { dev } from './core/dev'
import { init } from './core/init'
import { start, status, stop } from './core/stack'
import { failure, type Globals } from './output'

export const program = new Command()

program
  .name('simien')
  .version(pkg.version)
  .description('Postgres + Zega backends with a schema that syncs itself')
  .option('--human', 'readable output for people')
  .option('--nopretty', 'compact JSON')
  .helpCommand(false)

const globals = (): Globals => program.opts<Globals>()

/** A failure prints on stderr (JSON, or text with --human) and the exit code is 1. */
function action<A extends unknown[]>(run: (...args: A) => Promise<void>) {
  return async (...args: A): Promise<void> => {
    try {
      await run(...args)
    } catch (error) {
      process.stderr.write(failure(error, globals()))
      process.exitCode = 1
    }
  }
}

program
  .command('init')
  .description('start a project here: simien.json and simien/schema.ts')
  .option('--name <name>', 'project name (default: this directory)')
  .option('--port <port>', 'Postgres port; Zega uses the next one (default 54330)')
  .option('--force', 'overwrite simien.json and schema.ts')
  .action(action(async (options: { name?: string; port?: string; force?: boolean }) => init(globals(), options)))

program
  .command('dev')
  .description('run the local stack and keep the database, schema.ts and generated code in sync')
  .option('--once', 'sync once and exit (CI, agents)')
  .action(action(async (options: { once?: boolean }) => dev(globals(), options)))

program.command('start').description('start the local stack (Postgres + pg_zega, Zega)').action(action(async () => start(globals())))
program.command('stop').description('stop the local stack; data is kept').action(action(async () => stop(globals())))
program.command('status').description('is the local stack up?').action(action(async () => status(globals())))
