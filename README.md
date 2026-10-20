# simien

The Simien CLI. Simien is a backend on **Postgres + Zega**: Postgres for writes and everyday reads, Zega for deep graph queries, kept in the same transaction by [pg_zega](https://github.com/zegadb/pg_zega).

The development loop is modelled on Convex: you edit `simien/schema.ts`, and `simien dev` keeps the database and the generated TypeScript in step. Nothing is synced by hand.

```sh
simien init        # simien.json + simien/schema.ts
simien dev         # local stack, sync on every save, types in simien/_generated
simien dev --once  # sync once and exit (CI, agents)
```

`s` is the same command, for less typing: `s dev`, `s container ls`.

## Containers

Each project runs its own Postgres (with pg_zega) and Zega in Docker. [kebele](https://github.com/addiscorp/kebele) runs them over the Docker socket, and `simien dev` starts them for you.

| command | does |
|---|---|
| `simien container ls` | every Simien project's containers on this machine |
| `simien container status` | this project's Postgres and Zega: answering or not, health, ports |
| `simien container start` / `stop` | start and wait until both answer / stop; data is kept |
| `simien container logs [postgres\|zega] [--tail N] [-f]` | the containers' output |
| `simien container update` | pull the images this simien pins and replace containers running older ones; data is kept |
| `simien container reset --yes` | delete the project's data and start empty |

If another project already holds the ports, `start` says which one. Pick other ports with `simien init --port`.

## The schema

```ts
import { defineEdge, defineSchema, defineTable, v } from "@simien/client/schema"

export default defineSchema({
  users: defineTable({ name: v.string(), email: v.optional(v.string()) }),
  posts: defineTable({ title: v.string() }),
  wrote: defineEdge("users", "posts", { at: v.optional(v.float()) }),
})
```

A table is a Zega node type with an `_id` that Postgres assigns. An edge is a relationship, stored as the Postgres table `ze_<name>` with `source` and `target`. Field types are `v.string()`, `v.int()`, `v.float()`, `v.boolean()`, each optionally `v.optional(...)`.

## How a save is applied

Each save becomes one transaction. Simien checks the data first, then runs the DDL, the pg_zega tracking and any Zega reloads. If any step fails, nothing changes.

| Change | Result |
|---|---|
| Add a table, edge or optional field; make a field optional | Applied |
| Rename a field, table or edge: one name out, one in with the same shape | Warning; applied with `RENAME`, Zega reloads that scope |
| Remove a field, table or edge that holds data | **Error**: it would orphan the data |
| Remove one that's empty | Dropped, so no orphan columns are left behind |
| Add a required field to a table with rows, require a field that has empty rows, change a type over data | **Error**: widen first (`v.optional`), fill, then narrow |

A change made straight in Postgres (psql, another tool) while `simien dev` runs rewrites `schema.ts` to match.

## Output

JSON on stdout by default, one event per line from `simien dev`. Add `--human` for text. Failures are JSON on stderr with exit code 1, and a mistake in `schema.ts` carries its line and column.

## Layout

- `src/`: the CLI (Bun, TypeScript)
- `crates/simien-schema/`: every schema conversion, in Rust: parse `schema.ts`, read the Postgres catalog, plan migrations, write `schema.ts` and the generated types. Releases ship it as `@simien/schema-<platform>`.
- `tests/`: end-to-end tests against a real local stack (needs Docker)

```sh
bun install
bun run build:schema
bun test
```
