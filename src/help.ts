// The help, made from commander's own definitions so a new command can't be left out. JSON by
// default, in the zega CLI's shape: `simien` and `simien --help` describe the whole CLI, grouped;
// `simien <command> --help` one command. With --human it's commander's text, under the mark.

import { Help, type Command } from 'commander'

import { logo, showLogo } from './banner'

type Described = Record<string, string>

const groupKey = (heading: string) => heading.replace(/:$/, '').trim().toLowerCase() || 'other'

function optionsOf(helper: Help, options: ReturnType<Help['visibleOptions']>): Described {
  return Object.fromEntries(options.map((option) => [option.flags, helper.optionDescription(option)]))
}

export function helpObject(cmd: Command, helper: Help): Record<string, unknown> {
  const commands = helper.visibleCommands(cmd)
  const options = optionsOf(helper, helper.visibleOptions(cmd))
  if (cmd.parent === null) {
    const groups: Record<string, Record<string, unknown>> = {}
    for (const command of commands) {
      const subcommands = helper.visibleCommands(command)
      // A command with subcommands (`container`) lists them, so one call shows everything there is.
      ;(groups[groupKey(command.helpGroup())] ??= {})[command.name()] = subcommands.length
        ? Object.fromEntries(subcommands.map((sub) => [sub.name(), helper.subcommandDescription(sub)]))
        : helper.subcommandDescription(command)
    }
    return { name: cmd.name(), version: cmd.version(), description: cmd.description(), usage: helper.commandUsage(cmd), commands: groups, options }
  }
  const out: Record<string, unknown> = { command: cmd.name(), description: helper.commandDescription(cmd), usage: helper.commandUsage(cmd) }
  const args = helper.visibleArguments(cmd)
  if (args.length > 0) out.arguments = Object.fromEntries(args.map((arg) => [arg.name() + (arg.variadic ? '...' : ''), helper.argumentDescription(arg)]))
  if (commands.length > 0) out.commands = Object.fromEntries(commands.map((command) => [command.name(), helper.subcommandDescription(command)]))
  out.options = options
  const globals = helper.visibleGlobalOptions(cmd).filter((option) => !option.long?.match(/^--(help|version)$/))
  if (globals.length > 0) out.globalOptions = optionsOf(helper, globals)
  return out
}

/** The flags are read from argv: help is printed before commander has parsed them. */
const flag = (name: string) => process.argv.includes(name)

export function formatHelp(cmd: Command, helper: Help): string {
  if (flag('--human')) {
    const text = Help.prototype.formatHelp.call(helper, cmd, helper)
    return cmd.parent === null && showLogo(true) ? `\n${logo(true)}\n\n${text}` : text
  }
  return JSON.stringify(helpObject(cmd, helper), null, flag('--nopretty') ? undefined : 2) + '\n'
}

/** A command-line mistake, as JSON on stderr like any other error (text with --human). */
export function usageError(message: string): string {
  const text = message.replace(/^error: /, '').trim()
  // commander appends "(Did you mean container?)"; agents get it as its own field.
  const suggestion = text.match(/\(Did you mean (.+)\?\)/)?.[1]
  const plain = text.replace(/\s*\(Did you mean .+\?\)/, '')
  return flag('--human')
    ? `error: ${text}\nhint: simien --help --human\n`
    : JSON.stringify({ ok: false, error: { code: 'usage', message: plain, ...(suggestion ? { suggestion } : {}), hint: 'simien --help' } }) + '\n'
}
