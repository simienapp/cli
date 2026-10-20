// Postgres: read the catalog, apply a plan in one transaction, and hear about direct changes.

import postgres from 'postgres'

import { SimienError } from './output'
import { databaseUrl, type Project } from './project'
import type { Catalog, Plan } from './schema'

export type Sql = postgres.Sql

export function connect(project: Project): Sql {
  return postgres(databaseUrl(project), { max: 4, onnotice: () => {}, connect_timeout: 5 })
}

/** Whether Postgres answers a query right now. */
export async function answers(project: Project): Promise<boolean> {
  const sql = postgres(databaseUrl(project), { max: 1, onnotice: () => {}, connect_timeout: 2 })
  try {
    await sql`select 1`
    return true
  } catch {
    return false
  } finally {
    await sql.end({ timeout: 1 })
  }
}

/** Wait until Postgres answers a query (it accepts connections before it's ready for them). */
export async function ready(project: Project, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const sql = postgres(databaseUrl(project), { max: 1, onnotice: () => {}, connect_timeout: 2 })
    try {
      await sql`select 1`
      return
    } catch (error) {
      if (Date.now() > deadline) throw new SimienError(`Postgres isn't answering: ${(error as Error).message}`)
      await Bun.sleep(500)
    } finally {
      await sql.end({ timeout: 1 })
    }
  }
}

/** Every ordinary table in `public`, with columns, primary key and foreign keys. */
export async function catalog(sql: Sql): Promise<Catalog> {
  const tables = await sql<Catalog['tables']>`
    select c.relname as name,
      coalesce((select json_agg(json_build_object(
          'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'nullable', not a.attnotnull) order by a.attnum)
        from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '[]') as columns,
      coalesce((select json_agg(a.attname order by array_position(i.indkey::int2[], a.attnum))
        from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = c.oid and i.indisprimary), '[]') as "primaryKey",
      coalesce((select json_agg(json_build_object(
          'columns', (select json_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(n, ord)
                      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n),
          'table', rc.relname,
          'refColumns', (select json_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(n, ord)
                         join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n)))
        from pg_constraint con join pg_class rc on rc.oid = con.confrelid
        where con.conrelid = c.oid and con.contype = 'f'), '[]') as "foreignKeys"
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`
  return { tables: [...tables] }
}

/** A guard found data the change would break or orphan. Nothing was applied. */
export class GuardError extends SimienError {}

/**
 * Apply a plan all or nothing: guards first (they only read), then the DDL, pg_zega tracking and
 * reloads, in one transaction. `simien.syncing` keeps our own DDL from coming back as a
 * "the database changed" notification.
 */
export async function apply(sql: Sql, plan: Plan): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select set_config('simien.syncing', 'on', true)`
    const blocked: string[] = []
    for (const guard of plan.guards) {
      const [row] = await tx.unsafe(guard.sql)
      if (row && Object.values(row)[0] === true) blocked.push(guard.error)
    }
    if (blocked.length > 0) {
      const count = blocked.length === 1 ? 'a change' : `${blocked.length} changes`
      throw new GuardError(`schema.ts asks for ${count} that would break or orphan data; nothing was applied`, { blocked })
    }
    for (const statement of plan.statements) await tx.unsafe(statement)
  })
}

const CHANNEL = 'simien_schema'

/** Install the event trigger that reports DDL from anyone but `simien dev` itself. */
export async function installNotifier(sql: Sql): Promise<void> {
  await sql.unsafe(`
    create or replace function simien_ddl_notify() returns event_trigger language plpgsql as $$
    begin
      if coalesce(current_setting('simien.syncing', true), '') <> 'on' then
        perform pg_notify('${CHANNEL}', tg_tag);
      end if;
    end $$;
    do $$ begin
      if not exists (select 1 from pg_event_trigger where evtname = 'simien_ddl_notify') then
        create event trigger simien_ddl_notify on ddl_command_end execute function simien_ddl_notify();
      end if;
    end $$;`)
}

export async function onSchemaChange(sql: Sql, handler: (tag: string) => void): Promise<void> {
  await sql.listen(CHANNEL, handler)
}
