// The Rust binaries the CLI ships beside itself: from their per-platform npm
// package once installed, or from this checkout's .target/release when
// developing (bun run build:schema / build:check).

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { SimienError } from './output'

export type Binary = 'simien-schema' | 'simien-check'

export function binary(name: Binary): string {
  const local = join(import.meta.dir, '..', '.target', 'release', name)
  try {
    const require = createRequire(import.meta.url)
    return require.resolve(`@simien/${name.replace('simien-', '')}-${process.platform}-${process.arch}/bin/${name}`)
  } catch {
    if (existsSync(local)) return local
    throw new SimienError(`${name} isn't installed for ${process.platform}-${process.arch}`, {
      hint: `bun run build:${name.replace('simien-', '')}`,
    })
  }
}
