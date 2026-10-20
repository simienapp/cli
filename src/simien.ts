#!/usr/bin/env bun

import { program } from './program'

// `simien` alone (global flags aside) shows the help instead of doing nothing.
const GLOBAL = new Set(['--human', '--nopretty'])
if (process.argv.slice(2).every((arg) => GLOBAL.has(arg))) program.help()
await program.parseAsync()
process.exit(process.exitCode ?? 0)
