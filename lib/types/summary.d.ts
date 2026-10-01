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
export type SummaryLevel = 'working' | 'alarm' | 'attention' | 'unknown' | 'calm';
export interface Activity {
    busy: boolean;
    /** The domain currently being asked about — visible work beats a spinner. */
    domain: string | null;
    since: string | null;
}
export interface LastResult {
    domain: string;
    ok: boolean;
    at: string;
}
/** The subset of a watched row this file needs. Structural, so tests can build one inline. */
export interface SummaryRow {
    domain: string;
    phase: string;
    registered?: boolean;
    daysRemaining?: number | null;
    checkedAt?: string;
    lastError?: string;
}
export interface Summary {
    level: SummaryLevel;
    /** Ready to paint. Short: the pill is 40px tall. */
    label: string;
    /** A glyph when one carries meaning the words cannot: `✓` fine, `?` unknown. */
    glyph: string | null;
    /** ONE plain sentence, paired with every alarm. The tooltip and the board both use it. */
    action: string;
    counts: {
        watched: number;
        expiring: number;
        alarming: number;
        unchecked: number;
    };
    soonest: {
        domain: string;
        daysRemaining: number | null;
    } | null;
    activity: Activity;
    lastResult: LastResult | null;
}
export declare const IDLE: Activity;
/**
 * Decide what the pill says.
 *
 * PRECEDENCE, and why: `working` outranks trouble on purpose. The acknowledgement has to be
 * instant — that is the entire reason it exists — while an alarm is persistent and will still be
 * there two seconds later when the query returns. Everything else is ranked by how much it costs
 * to ignore it.
 */
export declare function summarize(rows: readonly SummaryRow[], activity?: Activity, lastResult?: LastResult | null): Summary;
