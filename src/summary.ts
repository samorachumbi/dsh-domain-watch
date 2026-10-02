/**
 * The one place a status is decided, for the pill AND the board.
 *
 * WHY THIS IS HOST-SIDE. A rule re-implemented in a page drifts from the rule in the tools, and the
 * two disagree the first time someone changes one. So the level, the words and the colour all come
 * from here; the client half paints what it is given and decides nothing.
 *
 * WHY THE WORDS ARE PLAIN ENGLISH. The person reading this pill is not a developer. Three rules
 * follow from that, and they are the whole design:
 *
 *   1. **Every alarming state carries a VERB.** A developer sees red and checks the logs; a layman
 *      sees red and gets anxiety with no next step, which is worse than no light at all. So
 *      `needs renewing` — not `suspended`. `not registered` — not `registry-silent`.
 *   2. **The light must be able to say "I don't know."** `?` rather than `✓` whenever a query
 *      failed. A status light that lies is the exact failure this plugin exists to prevent.
 *   3. **No number nobody can act on.** `365 days` is noise; it is only surfaced once it is close
 *      enough to matter. Progressive disclosure, decided here rather than in the pill.
 *
 * @module dsh-domain-watch/summary
 */

/** How urgent the pill is. The client maps these to colour and motion; nothing else. */
export type SummaryLevel = 'working' | 'alarm' | 'attention' | 'unknown' | 'calm'

export interface Activity {
  busy: boolean
  /** The domain currently being asked about — visible work beats a spinner. */
  domain: string | null
  since: string | null
}

export interface LastResult {
  domain: string
  ok: boolean
  at: string
}

/** The subset of a watched row this file needs. Structural, so tests can build one inline. */
export interface SummaryRow {
  domain: string
  phase: string
  registered?: boolean
  daysRemaining?: number | null
  checkedAt?: string
  lastError?: string
}

export interface Summary {
  level: SummaryLevel
  /** Ready to paint. Short: the pill is 40px tall. */
  label: string
  /** A glyph when one carries meaning the words cannot: `✓` fine, `?` unknown. */
  glyph: string | null
  /** ONE plain sentence, paired with every alarm. The tooltip and the board both use it. */
  action: string
  counts: { watched: number; expiring: number; alarming: number; unchecked: number }
  soonest: { domain: string; daysRemaining: number | null } | null
  activity: Activity
  lastResult: LastResult | null
}

const DEAD_PHASES = new Set(['past-expiry', 'suspended', 'deletable'])

export const IDLE: Activity = { busy: false, domain: null, since: null }

/**
 * Decide what the pill says.
 *
 * PRECEDENCE, and why: `working` outranks trouble on purpose. The acknowledgement has to be
 * instant — that is the entire reason it exists — while an alarm is persistent and will still be
 * there two seconds later when the query returns. Everything else is ranked by how much it costs
 * to ignore it.
 */
export function summarize(
  rows: readonly SummaryRow[],
  activity: Activity = IDLE,
  lastResult: LastResult | null = null,
): Summary {
  const watched = rows.length
  const unchecked = rows.filter((r) => (r.lastError ?? '') !== '').length
  const expiring = rows.filter((r) => r.phase === 'expiring').length
  const notRegistered = rows.filter((r) => r.registered === false && (r.lastError ?? '') === '').length
  const dead = rows.filter((r) => DEAD_PHASES.has(r.phase) && (r.lastError ?? '') === '').length
  const alarming = notRegistered + dead
  const neverChecked = rows.filter((r) => r.checkedAt === undefined).length

  const dated = rows.filter((r) => typeof r.daysRemaining === 'number')
  const soonest = dated.length === 0
    ? null
    : dated.reduce((a, b) => ((a.daysRemaining ?? 0) <= (b.daysRemaining ?? 0) ? a : b))
  const counts = { watched, expiring, alarming, unchecked }

  // 1. An invocation is happening right now. Acknowledgement first.
  if (activity.busy) {
    return {
      level: 'working',
      label: activity.domain === null ? 'checking…' : `checking ${activity.domain}…`,
      glyph: null,
      action: 'Asking the registry right now. This takes a second or two.',
      counts,
      soonest: soonest === null ? null : { domain: soonest.domain, daysRemaining: soonest.daysRemaining ?? null },
      activity,
      lastResult,
    }
  }

  const base = {
    counts,
    soonest: soonest === null ? null : { domain: soonest.domain, daysRemaining: soonest.daysRemaining ?? null },
    activity,
    lastResult,
  }

  // 2. Something is wrong that costs money or a name.
  if (notRegistered > 0) {
    return {
      ...base, level: 'alarm', label: 'not registered', glyph: null,
      action: 'You do not own this domain yet, whatever any dashboard says. Click to re-check; the Domains app in the Apps pill says what to do.',
    }
  }
  if (dead > 0) {
    return {
      ...base, level: 'alarm', label: 'needs renewing', glyph: null,
      action: 'This domain has expired. The site and the email stop working soon — renew today.',
    }
  }

  // 3. Something needs a look but nothing is lost YET.
  if (expiring > 0) {
    return {
      ...base, level: 'attention', label: expiring === 1 ? '1 expiring' : `${expiring} expiring`, glyph: null,
      action: 'Renews within 60 days. Click to re-check; the Domains app in the Apps pill shows which, and when.',
    }
  }
  if (unchecked > 0) {
    return {
      ...base, level: 'attention', label: unchecked === 1 ? '1 unchecked' : `${unchecked} unchecked`, glyph: null,
      action: 'A registry check did not complete, so this is not a clean bill of health. Click to re-check.',
    }
  }

  // 4. Never asked, so nothing is known. NOT the same as fine.
  if (watched > 0 && neverChecked === watched) {
    return {
      ...base, level: 'unknown', label: 'not checked yet', glyph: '?',
      action: 'Added but never asked about. Click to check them now.',
    }
  }
  if (watched === 0) {
    return {
      ...base, level: 'unknown', label: 'nothing watched', glyph: '?',
      action: 'No domains are being watched yet. Ask the agent to add one.',
    }
  }

  return {
    // STATE ONLY. The pill already prefixes the plugin's name, so a label of `domains` here
    // rendered as `domains | domains ✓` — a duplication caught by looking at the screenshot.
    ...base, level: 'calm', label: 'fine', glyph: '✓',
    action: watched === 1
      ? '1 domain watched and registered. Click to re-check.'
      : `${watched} domains watched and registered. Click to re-check.`,
  }
}
