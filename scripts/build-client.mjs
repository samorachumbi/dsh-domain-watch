/**
 * Copy the hand-written client half into `lib/`.
 *
 * WHY THIS EXISTS. `lib/client.js` is NOT compiled — `tsc` only ever writes JavaScript derived from
 * `src/*.ts`, and the client half is written by hand against `window.__ModuleLoader__`. So if it
 * lived in `lib/`, then `npm run clean` (`rm -rf lib`) would delete it, and the build would happily
 * succeed with the file gone. The plugin would still boot; the bubble would simply never appear,
 * with no error anywhere — the recorded silent-404 class.
 *
 * Keeping the source in `src/` and copying it makes the loss impossible: `clean` cannot reach it,
 * and a build that forgot to copy fails loudly below rather than silently shipping no pill.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'src', 'client.js')
const to = join(root, 'lib', 'client.js')

if (!existsSync(from)) {
  console.error('build-client: src/client.js is MISSING — the bubble would ship as nothing.')
  process.exit(1)
}

const source = readFileSync(from, 'utf8')
// The loader contract. A client module without this prologue is the recorded boot-screen crash.
for (const required of ['window.__ModuleLoader__.load({', 'id: "dsh-domain-watch"', 'exports.apply', 'exports.inject']) {
  if (!source.includes(required)) {
    console.error('build-client: client.js is missing "' + required + '" — refusing to ship it.')
    process.exit(1)
  }
}

mkdirSync(join(root, 'lib'), { recursive: true })
copyFileSync(from, to)
console.log('build-client: src/client.js -> lib/client.js (' + statSync(to).size + ' bytes, contract verified)')
