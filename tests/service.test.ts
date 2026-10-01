/**
 * The light must always go out.
 *
 * "checking…" is the one pill state a user cannot distinguish from a hung plugin. So the in-flight
 * marker is cleared in a `finally`, and these tests exist because a `finally` that has never been
 * run under failure is an assumption, not a guarantee.
 *
 * The store and the transport are fakes here; the real `whoisQuery` reaches the network and the
 * suite has none by design.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { createService } from '../src/service.ts'
import { KENIC_GRACE } from '../src/domain.ts'
import type { Watched } from '../src/domain.ts'

function fakeStore(seed: Watched[] = []) {
  const rows = new Map(seed.map((r) => [r.domain, r]))
  return {
    async list() { return [...rows.values()] },
    async get(d: string) { return rows.get(d) ?? null },
    async put(patch: Partial<Watched> & { domain: string }) {
      const merged = { ...(rows.get(patch.domain) ?? { addedAt: 'x' }), ...patch } as Watched
      rows.set(patch.domain, merged)
      return merged
    },
    async remove(d: string) { return rows.delete(d) },
  }
}

const deps = (query: (d: string, s: string, t: number) => Promise<string>) => ({
  store: fakeStore() as never,
  grace: KENIC_GRACE,
  warnWithinDays: 60,
  timeoutMs: 1000,
  query,
})

const REGISTERED = `Domain Name: itikia.co.ke
Creation Date: 2026-10-01T17:31:12Z
Registry Expiry Date: 2027-10-01T17:31:15Z
Registrar: Truehost AI
Domain Status: active https://icann.org/epp#active
Name Server: ns1.cloudoo.com
`

test('the in-flight flag is set while asking, and cleared after', async () => {
  // ONE service, observed from inside its own transport. An earlier version of this test built two
  // services and inspected the wrong one's map, so it asserted `false` for a flag that was working
  // correctly — the harness was wrong, not the code.
  let sawBusyMidFlight: boolean | null = null
  let service: ReturnType<typeof createService>
  service = createService(deps(async () => {
    sawBusyMidFlight = service.activity().busy
    return REGISTERED
  }))
  assert.equal(service.activity().busy, false, 'idle before the call')
  await service.check('itikia.co.ke')
  assert.equal(sawBusyMidFlight, true, 'the light must be ON while the query is in flight')
  assert.equal(service.activity().busy, false, 'and OFF once it returns')
  assert.equal(service.summary !== undefined, true)
})

test('THE GUARANTEE: a THROWING transport still clears the light', async () => {
  const service = createService(deps(async () => { throw new Error('registry refused the connection') }))
  await service.check('itikia.co.ke')
  assert.equal(service.activity().busy, false, 'a stuck "checking…" is indistinguishable from a hang')
})

test('a registry with no record does NOT leave the light on either', async () => {
  const service = createService(deps(async () => 'Domain Name: x.co.ke\nThe queried object does not exist: No Object Found\n'))
  const r = await service.check('x.co.ke')
  assert.equal(r.registered, false)
  assert.equal(service.activity().busy, false)
})

test('an unknown TLD never even sets the light — it answers without asking anyone', async () => {
  let called = false
  const service = createService(deps(async () => { called = true; return '' }))
  const r = await service.check('example.zz')
  assert.equal(called, false, 'no registry known means no query, so no in-flight state')
  assert.match(r.error, /No registry is known/i)
  assert.equal(service.activity().busy, false)
})

test('a failed query surfaces as attention with a ? — never as a tick', async () => {
  const service = createService(deps(async () => { throw new Error('timeout') }))
  const r = await service.check('itikia.co.ke')
  assert.notEqual(r.error, '', 'a failure must be reported as a failure')
  assert.equal(r.registered, false)
  // and the summary of a store holding that row must not claim health
  const s = await service.summary()
  assert.notEqual(s.glyph, '✓')
})

test('lastResult records that a check HAPPENED, which is what the done-flash paints', async () => {
  const service = createService(deps(async () => REGISTERED))
  await service.check('itikia.co.ke')
  const s = await service.summary()
  assert.equal(s.lastResult?.domain, 'itikia.co.ke')
  assert.equal(s.lastResult?.ok, true)
  assert.notEqual(s.lastResult?.at, undefined)
})
