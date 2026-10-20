// `simien check`: type-check the project with tsrs (the Rust port of the
// TypeScript 7 checker), through the simien-check binary.

import { relative } from 'node:path'

import * as stdio from '@zegadb/stdio'

import { binary } from '../binaries'
import { writeSchemaTypes } from '../generated'
import { result, SimienError, type Globals } from '../output'
import { findProject } from '../project'

export interface Diagnostic {
  file?: string
  line?: number
  column?: number
  code: number
  category: 'error' | 'warning' | 'suggestion' | 'message'
  message: string
}

export interface CheckReport {
  ok: boolean
  files: number
  diagnostics: Diagnostic[]
}

/** Run simien-check on the project. Type errors are a report, not a failure; a checker that can't run is. */
export async function runCheck(root: string): Promise<CheckReport> {
  const proc = Bun.spawn([binary('simien-check'), root], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  let parsed: (CheckReport & { error?: { message: string } }) | undefined
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new SimienError(`simien-check didn't answer: ${(stderr || stdout).trim() || `exit ${proc.exitCode}`}`)
  }
  if (!parsed) throw new SimienError('simien-check gave an empty answer')
  if (parsed.error) throw new SimienError(parsed.error.message)
  return parsed
}

export async function check(globals: Globals): Promise<void> {
  const project = findProject()
  // A project made before this file existed still type-checks.
  writeSchemaTypes(project)
  const report = await runCheck(project.root)
  const errors = report.diagnostics.filter((d) => d.category === 'error')
  result(report, globals, () => {
    for (const d of report.diagnostics) {
      const where = d.file ? `${relative(project.root, d.file) || d.file}${d.line ? `:${d.line}:${d.column}` : ''}` : 'project'
      const text = `${where}  TS${d.code}  ${d.message}`
      if (d.category === 'error') stdio.error('check', text)
      else stdio.warn('check', text)
    }
    if (errors.length === 0) stdio.success(`no type errors${report.files ? ` in ${report.files} files` : ''}`)
    else stdio.fail(`${errors.length} type error${errors.length === 1 ? '' : 's'}`)
  })
  if (errors.length > 0) process.exitCode = 1
}
