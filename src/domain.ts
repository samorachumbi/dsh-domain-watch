/**
 * Pure domain facts: parse a whois reply, age it against a clock, and judge a vendor's claim.
 *
 * Everything here is a pure function of its arguments so it can be tested against recorded
 * registry replies with no network. The network lives in `whois.ts`; this file never touches it.
 *
 * THE POINT OF THE PLUGIN IS `verdict()`.
 *
 * A registrar's control panel is a CACHE of the registry, and it is wrong in both directions:
 *
 *   - It said **paid / active** while the registry had **no record at all**. The customer had a
 *     receipt, a dashboard, an invoice number — and no domain. That cost real money and days.
 *   - Days later it said **Pending** while the registry said **active**. Nearly a false alarm
 *     about a domain that was already fine.
 *
 * Neither is a bug in the panel. It is what a cache is. The fix is not a better panel, it is
 * asking the authority — so every answer here carries what the registry says *and* what the
 * claim was, and names the disagreement instead of averaging it away.
 *
 * @module dsh-domain-watch/domain
 */

/** Markers that mean "this registry has no such object". Lower-cased before matching. */
export const NOT_FOUND_MARKERS = [
  'no object found',
  'no entries found',
  'no match for',
  'no data found',
  'domain not registered',
  'not found',
] as const

export interface DomainFacts {
  domain: string
  registered: boolean
  registrar: string | null
  createdAt: string | null
  expiresAt: string | null
  nameservers: string[]
  /** EPP status codes, first token only: `active`, `clientTransferProhibited`, … */
  statuses: string[]
  /** `clientTransferProhibited` / `clientHold` / `serverHold` present. */
  transferLocked: boolean
  /** The registry's own words, so a surprising answer can be read rather than guessed at. */
  raw: string
}

/** First non-empty value for any of `names`, case-insensitively, on a `Key: value` line. */
export function field(text: string, ...names: string[]): string | null {
  const wanted = new Set(names.map((n) => n.toLowerCase()))
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at === -1) continue
    const key = line.slice(0, at).trim().toLowerCase()
    const value = line.slice(at + 1).trim()
    if (wanted.has(key) && value !== '') return value
  }
  return null
}

/** Every value for `key`, in order — registries repeat `Domain Status` and `Name Server`. */
export function fieldAll(text: string, key: string): string[] {
  const wanted = key.toLowerCase()
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at === -1) continue
    if (line.slice(0, at).trim().toLowerCase() !== wanted) continue
    const value = line.slice(at + 1).trim()
    if (value !== '') out.push(value)
  }
  return out
}

export function parseWhois(domain: string, text: string): DomainFacts {
  const lowered = text.toLowerCase()
  const registered = !NOT_FOUND_MARKERS.some((marker) => lowered.includes(marker))

  if (!registered) {
    return {
      domain,
      registered: false,
      registrar: null,
      createdAt: null,
      expiresAt: null,
      nameservers: [],
      statuses: [],
      transferLocked: false,
      raw: text,
    }
  }

  const statuses = fieldAll(text, 'Domain Status').map((s) => s.split(/\s+/)[0] ?? s)
  const lockWords = ['clienttransferprohibited', 'clienthold', 'serverhold', 'servertransferprohibited']

  return {
    domain,
    registered: true,
    registrar: field(text, 'Registrar', 'Registrar Name', 'Sponsoring Registrar'),
    createdAt: field(text, 'Creation Date', 'Created', 'Created On', 'Registered On'),
    expiresAt: field(
      text,
      'Registry Expiry Date',
      'Registrar Registration Expiration Date',
      'Expiry Date',
      'Expiration Date',
      'Expires',
    ),
    nameservers: fieldAll(text, 'Name Server'),
    statuses,
    transferLocked: statuses.some((s) => lockWords.includes(s.toLowerCase())),
    raw: text,
  }
}

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

/**
 * How long after expiry a name still resolves, and how long after that it can be taken.
 *
 * These defaults are KENIC's, read from the `.ke` Third Level Policy (2026-10-01): expiry at one
 * year from creation, **suspended 14 days after expiry**, **deleted 90 days after expiry**, with a
 * restored name resuming the old billing cycle. Other registries differ, so both windows are
 * parameters and the page names them rather than pretending the numbers are universal.
 */
export interface GraceWindows {
  /** Days after expiry before the name stops resolving. */
  suspendAfter: number
  /** Days after expiry before anyone else may register it. */
  deleteAfter: number
}

export const KENIC_GRACE: GraceWindows = { suspendAfter: 14, deleteAfter: 90 }

export type LifecyclePhase = 'active' | 'expiring' | 'past-expiry' | 'suspended' | 'deletable' | 'unknown'

export interface Lifecycle {
  phase: LifecyclePhase
  /** Days until expiry. Negative once past it. `null` when the registry published no date. */
  daysRemaining: number | null
  /** Days until the name stops resolving (expiry + suspendAfter). `null` when unknown. */
  daysUntilSuspended: number | null
  /** Days until anyone may take it (expiry + deleteAfter). `null` when unknown. */
  daysUntilDeletable: number | null
  expiresAt: Date | null
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000)
}

export function lifecycle(
  expiresAt: string | null,
  now: Date,
  grace: GraceWindows = KENIC_GRACE,
  warnWithinDays = 60,
): Lifecycle {
  if (!expiresAt) {
    return { phase: 'unknown', daysRemaining: null, daysUntilSuspended: null, daysUntilDeletable: null, expiresAt: null }
  }
  const expiry = new Date(expiresAt)
  if (Number.isNaN(expiry.getTime())) {
    return { phase: 'unknown', daysRemaining: null, daysUntilSuspended: null, daysUntilDeletable: null, expiresAt: null }
  }

  const daysRemaining = daysBetween(now, expiry)
  const daysUntilSuspended = daysRemaining + grace.suspendAfter
  const daysUntilDeletable = daysRemaining + grace.deleteAfter

  let phase: LifecyclePhase
  if (daysRemaining > warnWithinDays) phase = 'active'
  else if (daysRemaining > 0) phase = 'expiring'
  else if (daysUntilSuspended > 0) phase = 'past-expiry'
  else if (daysUntilDeletable > 0) phase = 'suspended'
  else phase = 'deletable'

  return { phase, daysRemaining, daysUntilSuspended, daysUntilDeletable, expiresAt: expiry }
}

// ---------------------------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------------------------

export type ClaimState = 'registered' | 'pending' | 'unknown'

const REGISTERED_WORDS = ['active', 'registered', 'paid', 'complete', 'completed', 'live', 'ok', 'done', 'success', 'issued']
const PENDING_WORDS = ['pending', 'processing', 'awaiting', 'queued', 'unpaid', 'incomplete', 'in progress', 'review', 'provisioning']

/** Turn whatever the vendor's panel said into one of three honest states. */
export function classifyClaim(claimed: string | null | undefined): ClaimState {
  if (claimed === null || claimed === undefined || claimed.trim() === '') return 'unknown'
  const c = claimed.trim().toLowerCase()
  if (PENDING_WORDS.some((w) => c.includes(w))) return 'pending'
  if (REGISTERED_WORDS.some((w) => c.includes(w))) return 'registered'
  return 'unknown'
}

export type VerdictCode =
  | 'confirmed'
  | 'registry-ahead'
  | 'registry-silent'
  | 'in-progress'
  | 'registry-only'

export interface Verdict {
  code: VerdictCode
  /** One line a human can act on. */
  headline: string
  /** This is the one that has cost money. */
  alarming: boolean
}

/**
 * Judge the claim against the registry.
 *
 * `registry-silent` is the failure this plugin exists for: the panel says the domain is yours and
 * the registry has never heard of it. It is not "probably fine" — it means there is nothing to
 * own yet, and the only correct move is to stop waiting and act.
 */
export function verdict(facts: DomainFacts, claimed?: string | null): Verdict {
  const claim = classifyClaim(claimed)

  if (claim === 'unknown') {
    return {
      code: 'registry-only',
      headline: facts.registered
        ? `The registry has ${facts.domain}, registrar ${facts.registrar ?? 'unstated'}.`
        : `The registry has NO record of ${facts.domain}.`,
      alarming: !facts.registered,
    }
  }

  if (facts.registered && claim === 'registered') {
    return { code: 'confirmed', headline: 'Both agree: the registry has it and so does the panel.', alarming: false }
  }
  if (facts.registered && claim === 'pending') {
    return {
      code: 'registry-ahead',
      headline: 'The registry ALREADY has it — the panel is a cache that has not caught up. Do not re-order.',
      alarming: false,
    }
  }
  if (!facts.registered && claim === 'registered') {
    return {
      code: 'registry-silent',
      headline: 'The panel says it is yours and the registry has NO record of it. You do not own this name yet.',
      alarming: true,
    }
  }
  return {
    code: 'in-progress',
    headline: 'Neither the panel nor the registry shows it registered — the order has not landed.',
    alarming: true,
  }
}


/**
 * A watched domain, as the merge helper sees it.
 *
 * Declared here — in the dependency-free module — rather than in `store.ts`, so the merge rule can
 * be tested without pulling zod and the storage facility into the test process. `store.ts`'s zod
 * schema is the runtime authority and conforms to this shape; the compiler holds the two together.
 */
export interface Watched {
  domain: string
  note?: string
  addedAt: string
  checkedAt?: string
  registered?: boolean
  registrar?: string
  createdAt?: string
  expiresAt?: string
  nameservers?: string[]
  statuses?: string[]
  /** The last query's failure, kept so a network error is never read as "not registered". */
  lastError?: string
}

/**
 * Merge a patch into an existing record. **One helper, used by every writer.**
 *
 * A `put` that replaces the record silently wipes fields the caller did not mention — the exact
 * shape of bug A10, where a selection write took the project link with it. Re-checking a domain
 * must not erase the operator's note, and adding a note must not erase the last registry answer.
 * So writes are read-then-merge, always, and `undefined` means "leave it".
 */
export function mergeWatched(existing: Watched | null, patch: Partial<Watched>): Watched {
  const base: Watched = existing ?? { domain: patch.domain ?? '', addedAt: new Date().toISOString() }
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value
  }
  return out as unknown as Watched
}
