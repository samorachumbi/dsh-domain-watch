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
];
/** First non-empty value for any of `names`, case-insensitively, on a `Key: value` line. */
export function field(text, ...names) {
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    for (const line of text.split(/\r?\n/)) {
        const at = line.indexOf(':');
        if (at === -1)
            continue;
        const key = line.slice(0, at).trim().toLowerCase();
        const value = line.slice(at + 1).trim();
        if (wanted.has(key) && value !== '')
            return value;
    }
    return null;
}
/** Every value for `key`, in order — registries repeat `Domain Status` and `Name Server`. */
export function fieldAll(text, key) {
    const wanted = key.toLowerCase();
    const out = [];
    for (const line of text.split(/\r?\n/)) {
        const at = line.indexOf(':');
        if (at === -1)
            continue;
        if (line.slice(0, at).trim().toLowerCase() !== wanted)
            continue;
        const value = line.slice(at + 1).trim();
        if (value !== '')
            out.push(value);
    }
    return out;
}
export function parseWhois(domain, text) {
    const lowered = text.toLowerCase();
    const registered = !NOT_FOUND_MARKERS.some((marker) => lowered.includes(marker));
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
        };
    }
    const statuses = fieldAll(text, 'Domain Status').map((s) => s.split(/\s+/)[0] ?? s);
    const lockWords = ['clienttransferprohibited', 'clienthold', 'serverhold', 'servertransferprohibited'];
    return {
        domain,
        registered: true,
        registrar: field(text, 'Registrar', 'Registrar Name', 'Sponsoring Registrar'),
        createdAt: field(text, 'Creation Date', 'Created', 'Created On', 'Registered On'),
        expiresAt: field(text, 'Registry Expiry Date', 'Registrar Registration Expiration Date', 'Expiry Date', 'Expiration Date', 'Expires'),
        nameservers: fieldAll(text, 'Name Server'),
        statuses,
        transferLocked: statuses.some((s) => lockWords.includes(s.toLowerCase())),
        raw: text,
    };
}
export const KENIC_GRACE = { suspendAfter: 14, deleteAfter: 90 };
/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from, to) {
    return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}
export function lifecycle(expiresAt, now, grace = KENIC_GRACE, warnWithinDays = 60) {
    if (!expiresAt) {
        return { phase: 'unknown', daysRemaining: null, daysUntilSuspended: null, daysUntilDeletable: null, expiresAt: null };
    }
    const expiry = new Date(expiresAt);
    if (Number.isNaN(expiry.getTime())) {
        return { phase: 'unknown', daysRemaining: null, daysUntilSuspended: null, daysUntilDeletable: null, expiresAt: null };
    }
    const daysRemaining = daysBetween(now, expiry);
    const daysUntilSuspended = daysRemaining + grace.suspendAfter;
    const daysUntilDeletable = daysRemaining + grace.deleteAfter;
    let phase;
    if (daysRemaining > warnWithinDays)
        phase = 'active';
    else if (daysRemaining > 0)
        phase = 'expiring';
    else if (daysUntilSuspended > 0)
        phase = 'past-expiry';
    else if (daysUntilDeletable > 0)
        phase = 'suspended';
    else
        phase = 'deletable';
    return { phase, daysRemaining, daysUntilSuspended, daysUntilDeletable, expiresAt: expiry };
}
const REGISTERED_WORDS = ['active', 'registered', 'paid', 'complete', 'completed', 'live', 'ok', 'done', 'success', 'issued'];
const PENDING_WORDS = ['pending', 'processing', 'awaiting', 'queued', 'unpaid', 'incomplete', 'in progress', 'review', 'provisioning'];
/** Turn whatever the vendor's panel said into one of three honest states. */
export function classifyClaim(claimed) {
    if (claimed === null || claimed === undefined || claimed.trim() === '')
        return 'unknown';
    const c = claimed.trim().toLowerCase();
    if (PENDING_WORDS.some((w) => c.includes(w)))
        return 'pending';
    if (REGISTERED_WORDS.some((w) => c.includes(w)))
        return 'registered';
    return 'unknown';
}
/**
 * Judge the claim against the registry.
 *
 * `registry-silent` is the failure this plugin exists for: the panel says the domain is yours and
 * the registry has never heard of it. It is not "probably fine" — it means there is nothing to
 * own yet, and the only correct move is to stop waiting and act.
 */
export function verdict(facts, claimed) {
    const claim = classifyClaim(claimed);
    if (claim === 'unknown') {
        return {
            code: 'registry-only',
            headline: facts.registered
                ? `The registry has ${facts.domain}, registrar ${facts.registrar ?? 'unstated'}.`
                : `The registry has NO record of ${facts.domain}.`,
            alarming: !facts.registered,
        };
    }
    if (facts.registered && claim === 'registered') {
        return { code: 'confirmed', headline: 'Both agree: the registry has it and so does the panel.', alarming: false };
    }
    if (facts.registered && claim === 'pending') {
        return {
            code: 'registry-ahead',
            headline: 'The registry ALREADY has it — the panel is a cache that has not caught up. Do not re-order.',
            alarming: false,
        };
    }
    if (!facts.registered && claim === 'registered') {
        return {
            code: 'registry-silent',
            headline: 'The panel says it is yours and the registry has NO record of it. You do not own this name yet.',
            alarming: true,
        };
    }
    return {
        code: 'in-progress',
        headline: 'Neither the panel nor the registry shows it registered — the order has not landed.',
        alarming: true,
    };
}
/**
 * Merge a patch into an existing record. **One helper, used by every writer.**
 *
 * A `put` that replaces the record silently wipes fields the caller did not mention — the exact
 * shape of bug A10, where a selection write took the project link with it. Re-checking a domain
 * must not erase the operator's note, and adding a note must not erase the last registry answer.
 * So writes are read-then-merge, always, and `undefined` means "leave it".
 */
export function mergeWatched(existing, patch) {
    const base = existing ?? { domain: patch.domain ?? '', addedAt: new Date().toISOString() };
    const out = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined)
            out[key] = value;
    }
    return out;
}
