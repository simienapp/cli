import { Command } from 'commander'

import pkg from '../package.json'
import { dev } from './core/dev'
import { init } from './core/init'
import * as container from './core/container'
import { formatHelp, usageError } from './help'
import { failure, type Globals } from './output'

export const program = new Command()

program
  .name('simien')
  .version(pkg.version)
  .description('Postgres + Zega backends with a schema that syncs itself')
  .option('--human', 'readable output for people')
  .option('--nopretty', 'compact JSON')
  .helpCommand(false)
  .configureHelp({ formatHelp, showGlobalOptions: true })
  .configureOutput({ outputError: (text, write) => write(usageError(text)) })

const globals = (): Globals => program.opts<Globals>()

/** A failure prints on stderr (JSON, or text with --human) and the exit code is 1. */
function action<A extends unknown[]>(run: (...args: A) => Promise<void>) {
  return async (...args: A): Promise<void> => {
    try {
      await run(...args)
    } catch (error) {
      failure(error, globals())
      process.exitCode = 1
    }
  }
}

program
  .command('init')
  .helpGroup('Project:')
  .description('start a project here: simien.json and simien/schema.ts')
  .option('--name <name>', 'project name (default: this directory)')
  .option('--port <port>', 'Postgres port; Zega uses the next one (default 54330)')
  .option('--force', 'overwrite simien.json and schema.ts')
  .action(action(async (options: { name?: string; port?: string; force?: boolean }) => init(globals(), options)))

program
  .command('dev')
  .helpGroup('Project:')
  .description('run the local stack and keep the database, schema.ts and generated code in sync')
  .option('--once', 'sync once and exit (CI, agents)')
  .action(action(async (options: { once?: boolean }) => dev(globals(), options)))

const containers = program
  .command('container')
  .helpGroup('Local:')
  .description("the project's Postgres + pg_zega and Zega containers")
  .helpCommand(false)
  // `simien container` alone lists its commands, like `simien` does.
  .action(() => containers.help())

containers.command('ls').description("every Simien project's containers on this machine").action(action(async () => container.ls(globals())))
containers.command('status').description('are Postgres and Zega up and answering?').action(action(async () => container.status(globals())))
containers.command('start').description('start Postgres and Zega and wait until both answer').action(action(async () => container.start(globals())))
containers.command('stop').description('stop and remove the containers; data is kept').action(action(async () => container.stop(globals())))
containers
  .command('logs')
  .description('the containers\' output')
  .argument('[service]', 'postgres or zega (default: both)')
  .option('--tail <lines>', 'only the last N lines')
  .option('-f, --follow', 'keep printing new output (one service)')
  .action(action(async (service: string | undefined, options: { tail?: string; follow?: boolean }) => container.logs(globals(), service, options)))
containers
  .command('update')
  .description('pull the images this simien pins and replace containers on older ones; data is kept')
  .action(action(async () => container.update(globals())))
containers
  .command('reset')
  .description("delete the project's data and start empty")
  .option('--yes', 'confirm: every row in Postgres and Zega is deleted')
  .action(action(async (options: { yes?: boolean }) => container.reset(globals(), options)))
