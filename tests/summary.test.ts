/**
 * The pill's brain.
 *
 * The defect these tests exist to prevent is a status light that lies. A pill that shows `✓` when
 * it has not checked, or `✓` when a query failed, is the exact failure this plugin was built to
 * catch — a vendor dashboard asserted a domain was fine while the registry had nothing. Building
 * the same lie into our own indicator would be worse than shipping no indicator at all.
 *
 * The second thing pinned here is the LAYMAN rule: every alarming state must carry a verb. A
 * developer sees red and checks the logs; everyone else sees red and needs to be told what to do.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { IDLE, summarize, type SummaryRow } from '../src/summary.ts'

const row = (over: Partial<SummaryRow> = {}): SummaryRow => ({
  domain: 'itikia.co.ke',
  phase: 'active',
  registered: true,
  daysRemaining: 365,
  checkedAt: '2026-10-01T17:31:12Z',
  ...over,
})

// ------------------------------------------------------------------ the happy path

test('all healthy is calm, and calm is the ONLY state that earns a tick', () => {
  const s = summarize([row(), row({ domain: 'b.co.ke' })])
  assert.equal(s.level, 'calm')
  assert.equal(s.glyph, '✓')
  assert.equal(s.counts.watched, 2)
})

// ------------------------------------------------------------------ alarm outranks everything but work

test('a domain the registry does not have is the loudest state, and it carries a verb', () => {
  const s = summarize([row({ registered: false, phase: 'unknown' })])
  assert.equal(s.level, 'alarm')
  assert.equal(s.label, 'not registered')
  assert.equal(s.glyph, null)
  // The verb: a layman must be told what this means, not just that something is wrong.
  assert.match(s.action, /do not own/i)
})

test('an expired domain says what to DO, not what phase it is in', () => {
  for (const phase of ['past-expiry', 'suspended', 'deletable']) {
    const s = summarize([row({ phase })])
    assert.equal(s.level, 'alarm', phase)
    assert.equal(s.label, 'needs renewing', phase)
    assert.match(s.action, /renew/i)
  }
})

test('expiring soon is attention, not alarm — nothing is lost yet', () => {
  const s = summarize([row({ phase: 'expiring', daysRemaining: 40 })])
  assert.equal(s.level, 'attention')
  assert.equal(s.label, '1 expiring')
})

// ------------------------------------------------------------------ THE HONEST `?`

test('A FAILED QUERY IS NEVER FINE — the single most important rule here', () => {
  const s = summarize([row({ lastError: 'whois.kenic.or.ke did not answer within 15000ms' })])
  assert.notEqual(s.level, 'calm', 'a failed query must not read as a clean bill of health')
  assert.notEqual(s.glyph, '✓', 'a tick over a query that never ran is exactly the lie this guards')
  assert.equal(s.level, 'attention')
  assert.match(s.action, /did not complete/i)
})

test('a failed query outranks a healthy neighbour — one unknown spoils the tick', () => {
  const s = summarize([row(), row({ domain: 'b.co.ke', lastError: 'timeout' })])
  assert.notEqual(s.glyph, '✓')
  assert.equal(s.counts.unchecked, 1)
})

test('a not-registered row that ALSO failed to be checked is checked-unknown, not accused', () => {
  // `registered:false` from a failed query is not evidence of anything. Do not cry wolf.
  const s = summarize([row({ registered: false, lastError: 'timeout' })])
  assert.equal(s.level, 'attention')
  assert.equal(s.counts.alarming, 0)
})

test('never checked is unknown, and NOT the same as fine', () => {
  const s = summarize([row({ checkedAt: undefined, daysRemaining: null })])
  assert.equal(s.level, 'unknown')
  assert.equal(s.glyph, '?')
})

test('nothing watched is unknown rather than a reassuring tick', () => {
  const s = summarize([])
  assert.equal(s.level, 'unknown')
  assert.equal(s.glyph, '?')
  assert.equal(s.counts.watched, 0)
})

// ------------------------------------------------------------------ the invocation

test('an invocation outranks trouble, because the acknowledgement has to be instant', () => {
  const s = summarize(
    [row({ registered: false })],
    { busy: true, domain: 'itikia.co.ke', since: '2026-10-01T20:00:00Z' },
  )
  assert.equal(s.level, 'working')
  // Visible work beats a spinner: it names what is being asked about.
  assert.match(s.label, /checking itikia\.co\.ke/)
  // ...but the alarm is not lost — it is in the counts, and it returns the moment the call ends.
  assert.equal(s.counts.alarming, 1)
})

test('busy with no domain yet still says something, rather than going blank', () => {
  assert.match(summarize([row()], { busy: true, domain: null, since: null }).label, /checking/)
})

// ------------------------------------------------------------------ counters and the countdown

test('counts are per-reason, so the board and the pill agree', () => {
  const s = summarize([
    row(),
    row({ domain: 'b.co.ke', phase: 'expiring', daysRemaining: 30 }),
    row({ domain: 'c.co.ke', phase: 'suspended', daysRemaining: -5 }),
    row({ domain: 'd.co.ke', lastError: 'timeout' }),
  ])
  assert.deepEqual(s.counts, { watched: 4, expiring: 1, alarming: 1, unchecked: 1 })
})

test('soonest is the domain closest to dying, and undated rows are ignored', () => {
  const s = summarize([
    row({ domain: 'far.co.ke', daysRemaining: 300 }),
    row({ domain: 'near.co.ke', daysRemaining: 12 }),
    row({ domain: 'undated.co.ke', daysRemaining: null, checkedAt: undefined }),
  ])
  assert.equal(s.soonest?.domain, 'near.co.ke')
  assert.equal(s.soonest?.daysRemaining, 12)
})

test('with no dated rows, soonest is null rather than a fabricated zero', () => {
  assert.equal(summarize([row({ daysRemaining: null })]).soonest, null)
})

test('IDLE is exported so a caller can pass a default without inventing one', () => {
  assert.deepEqual(IDLE, { busy: false, domain: null, since: null })
})
