/**
 * The pill's DECISION and the pill's CLICK.
 *
 * WHY THIS FILE EXISTS. On 2026-10-01 the pill shipped with a click that opened a browser tab
 * (while the host's own tooltip said "Click to check them now") and a `working` state whose real
 * lifetime was 24-74 ms behind a 1 s poll — so the one thing the README calls its best idea,
 * "colour changes on invocation, not on completion", was a claim the code did not keep. Nothing
 * caught it because the decision was inlined in a React function body and could not be called.
 *
 * So the decision was hoisted to a pure function, and here it is called for real.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')
/** Comments are where we WRITE about old behaviour, so they must not count as the behaviour. */
const CODE = SOURCE.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')

interface PillState {
  level: string
  label: string
  action: string
  glyph: string | null
  acknowledging: boolean
  showDone: boolean
}
interface PillArgs {
  reachable: boolean | null
  summary: Record<string, unknown> | null
  now: number
  invokedUntil: number
  doneUntil: number
}
interface PillModule { pillState: (args: PillArgs) => PillState }

/**
 * Load the hand-written client half the way the HARNESS does — a stub loader and a stub react. The
 * module body only defines things, so this is safe, and it is the only way to reach the pill's
 * decision without a DOM.
 */
function loadPill(): PillModule {
  let captured: { id?: string; factory?: (req: (name: string) => unknown) => unknown } = {}
  const fakeWindow = {
    __ModuleLoader__: { load: (mod: typeof captured) => { captured = mod } },
    matchMedia: () => ({ matches: false }),
  }
  new Function('window', SOURCE)(fakeWindow)
  assert.equal(captured.id, 'dsh-domain-watch', 'the loader id is the recorded boot-crash contract')
  assert.equal(typeof captured.factory, 'function', 'the factory prologue must be present')
  const react = {
    createElement: () => null,
    useState: () => [null, () => {}],
    useRef: () => ({ current: null }),
    useEffect: () => {},
  }
  const out = (captured.factory as (r: (n: string) => unknown) => unknown)((n) => (n === 'react' ? react : null))
  assert.equal(typeof (out as PillModule).pillState, 'function', 'pillState must be exported for these tests')
  return out as PillModule
}

const pill = loadPill()

const CALM = { level: 'calm', label: 'fine', glyph: '✓', action: 'Nothing to do.', lastResult: null }
const FAILED = { level: 'attention', label: '2 unchecked', glyph: '?', action: 'Open the board.', lastResult: null }
const MID = { level: 'working', label: 'checking itikia.co.ke…', glyph: null, action: 'Asking.', lastResult: null }
const base: PillArgs = { reachable: true, summary: CALM, now: 1000, invokedUntil: 0, doneUntil: 0 }

// ---------------------------------------------------------------------------------------------
// THE DEFECT, as a test.
// ---------------------------------------------------------------------------------------------

test('THE FIX: a click is acknowledged even when the registry answers instantly', () => {
  // `invokedUntil` in the future means the user's click has just happened. The summary says `calm`
  // because a .ke whois answered in 24 ms — the state that used to swallow the acknowledgement.
  const s = pill.pillState({ ...base, invokedUntil: 2000, now: 1000 })
  assert.equal(s.level, 'working', 'the click must be visible from the moment it happens')
  assert.equal(s.acknowledging, true)
})

test('the acknowledgement is BOUNDED — the truth takes over when it expires', () => {
  const s = pill.pillState({ ...base, invokedUntil: 1000, now: 1000 })
  assert.equal(s.acknowledging, false)
  assert.equal(s.level, 'calm', 'once the floor elapses the summary speaks again')
})

test('a FAILURE can never hide behind the acknowledgement', () => {
  const s = pill.pillState({ ...base, summary: FAILED, invokedUntil: 1000, now: 5000 })
  assert.equal(s.level, 'attention', 'the acknowledgement must not outlive its bound')
})

test('the acknowledgement outranks the green done-flash too', () => {
  const s = pill.pillState({ ...base, invokedUntil: 3000, doneUntil: 9000, now: 1000 })
  assert.equal(s.level, 'working', 'blue first: the user just acted')
})

test('while genuinely mid-check the host\'s own words are used', () => {
  const s = pill.pillState({ ...base, summary: MID, invokedUntil: 2000, now: 1000 })
  assert.equal(s.label, 'checking itikia.co.ke…', 'not a generic string when the host knows better')
})

// ---------------------------------------------------------------------------------------------
// The three rules, each as an assertion.
// ---------------------------------------------------------------------------------------------

test('rule 2: before the first poll answers it says nothing, not `?`', () => {
  const s = pill.pillState({ ...base, reachable: null })
  assert.equal(s.level, 'connecting', '`?` before the first answer is a lie at the worst moment')
  assert.equal(s.label, '…')
})

test('rule 2: unreachable is `?`, and NEVER a tick', () => {
  const s = pill.pillState({ ...base, reachable: false, summary: CALM })
  assert.equal(s.level, 'unknown')
  assert.equal(s.label, '?')
  assert.equal(s.glyph, null, 'a status light that guesses a tick is the bug this plugin exists to catch')
})

test('the done-flash names the domain that was just checked', () => {
  const s = pill.pillState({ ...base, doneUntil: 9000, now: 1000, summary: { ...CALM, lastResult: { domain: 'itikia.co.ke', at: 'x', ok: true } } })
  assert.equal(s.level, 'done')
  assert.equal(s.label, 'itikia.co.ke')
  assert.equal(s.glyph, '✓')
})

// ---------------------------------------------------------------------------------------------
// The wiring, which is text-visible.
// ---------------------------------------------------------------------------------------------

test('the click no longer opens a tab — that gesture made "click to check" a lie', () => {
  assert.equal(/window\.open/.test(CODE), false, 'the pill must not open a window on click')
})

test('the click RE-CHECKS', () => {
  assert.match(CODE, /fetch\("\/domain-watch\/recheck", \{ method: "POST"/, 'the click must call the recheck route')
  const up = CODE.slice(CODE.indexOf('function onPointerUp'))
  const body = up.slice(0, up.indexOf('\n      }'))
  assert.match(body, /invokeRecheck\(\)/, 'onPointerUp must invoke the re-check')
})

test('a drag is still not a click', () => {
  const up = CODE.slice(CODE.indexOf('function onPointerUp'))
  assert.match(up.slice(0, up.indexOf('\n      }')), /if \(d && d\.moved\) return;/, 'moving the pill must not fire a check')
})

test('the acknowledgement has a FLOOR', () => {
  const m = /const ACK_MS = (\d+);/.exec(CODE)
  assert.ok(m, 'ACK_MS must exist')
  const ack = Number((m as RegExpExecArray)[1])
  assert.ok(ack >= 1000, 'ACK_MS is ' + ack + ' ms; below a second a human does not register it')
})

test('the tooltip describes what a click now does', () => {
  assert.match(CODE, /click to re-check/)
  assert.equal(/click to open/.test(CODE), false, 'the old wording promised a tab')
})

test('moving the board off the pill did NOT delete the board', () => {
  // This guard caught its own author: the first version asserted the PILL still referenced
  // `/domain-watch/ui` — precisely what the fix removed — so it failed on correct code. The
  // invariant worth holding is that the HOST still serves the page. The board changed address;
  // it did not die.
  const page = readFileSync(new URL('../src/page.ts', import.meta.url), 'utf8')
  assert.match(page, /ROUTE_PREFIX \+ '\/ui'/, 'the board route must still exist on the host')
  assert.match(page, /ROUTE_PREFIX \+ '\/recheck'/, 'and the recheck route the pill calls must exist')
})
