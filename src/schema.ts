// The bridge to `simien-schema`, the Rust binary that owns every schema conversion.

import { binary } from './binaries'
import { SimienError } from './output'

export type FieldType = 'int' | 'float' | 'bool' | 'string'
export interface Field { name: string; type: FieldType; optional: boolean }
export interface Schema {
  tables: { name: string; fields: Field[] }[]
  edges: { name: string; from: string; to: string; fields: Field[] }[]
}
export interface Catalog {
  tables: {
    name: string
    columns: { name: string; type: string; nullable: boolean }[]
    primaryKey: string[]
    foreignKeys: { columns: string[]; table: string; refColumns: string[] }[]
  }[]
}
export interface Plan {
  changes: string[]
  warnings: string[]
  guards: { sql: string; error: string }[]
  statements: string[]
}
export interface Unmanaged { table: string; reason: string }
export interface PlanResult { plan: Plan; current: Schema; schema: Schema; dataModel: string; unmanaged: Unmanaged[] }
export interface PullResult { schema: Schema; schemaTs: string; dataModel: string; unmanaged: Unmanaged[] }

async function run<T>(command: 'plan' | 'pull', input: unknown, file?: string): Promise<T> {
  const proc = Bun.spawn([binary('simien-schema'), command], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
  proc.stdin.write(JSON.stringify(input))
  await proc.stdin.end()
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  let parsed: { ok: boolean; error?: { message: string; line?: number; column?: number } } & T
  try {
    parsed = JSON.parse(out)
  } catch {
    throw new SimienError(`simien-schema crashed: ${err.trim() || out.trim()}`)
  }
  if (!parsed.ok) {
    const { message, ...where } = parsed.error ?? { message: 'unknown error' }
    throw new SimienError(message, file ? { file, ...where } : where)
  }
  return parsed
}

export const plan = (schemaTs: string, catalog: Catalog, file: string) => run<PlanResult>('plan', { schemaTs, catalog }, file)
export const pull = (catalog: Catalog) => run<PullResult>('pull', { catalog })
