#!/usr/bin/env bun

import { program } from './program'

if (process.argv.length <= 2) program.help()
await program.parseAsync()
process.exit(process.exitCode ?? 0)
