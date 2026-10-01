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
export declare const NOT_FOUND_MARKERS: readonly ["no object found", "no entries found", "no match for", "no data found", "domain not registered", "not found"];
export interface DomainFacts {
    domain: string;
    registered: boolean;
    registrar: string | null;
    createdAt: string | null;
    expiresAt: string | null;
    nameservers: string[];
    /** EPP status codes, first token only: `active`, `clientTransferProhibited`, … */
    statuses: string[];
    /** `clientTransferProhibited` / `clientHold` / `serverHold` present. */
    transferLocked: boolean;
    /** The registry's own words, so a surprising answer can be read rather than guessed at. */
    raw: string;
}
/** First non-empty value for any of `names`, case-insensitively, on a `Key: value` line. */
export declare function field(text: string, ...names: string[]): string | null;
/** Every value for `key`, in order — registries repeat `Domain Status` and `Name Server`. */
export declare function fieldAll(text: string, key: string): string[];
export declare function parseWhois(domain: string, text: string): DomainFacts;
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
    suspendAfter: number;
    /** Days after expiry before anyone else may register it. */
    deleteAfter: number;
}
export declare const KENIC_GRACE: GraceWindows;
export type LifecyclePhase = 'active' | 'expiring' | 'past-expiry' | 'suspended' | 'deletable' | 'unknown';
export interface Lifecycle {
    phase: LifecyclePhase;
    /** Days until expiry. Negative once past it. `null` when the registry published no date. */
    daysRemaining: number | null;
    /** Days until the name stops resolving (expiry + suspendAfter). `null` when unknown. */
    daysUntilSuspended: number | null;
    /** Days until anyone may take it (expiry + deleteAfter). `null` when unknown. */
    daysUntilDeletable: number | null;
    expiresAt: Date | null;
}
/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export declare function daysBetween(from: Date, to: Date): number;
export declare function lifecycle(expiresAt: string | null, now: Date, grace?: GraceWindows, warnWithinDays?: number): Lifecycle;
export type ClaimState = 'registered' | 'pending' | 'unknown';
/** Turn whatever the vendor's panel said into one of three honest states. */
export declare function classifyClaim(claimed: string | null | undefined): ClaimState;
export type VerdictCode = 'confirmed' | 'registry-ahead' | 'registry-silent' | 'in-progress' | 'registry-only';
export interface Verdict {
    code: VerdictCode;
    /** One line a human can act on. */
    headline: string;
    /** This is the one that has cost money. */
    alarming: boolean;
}
/**
 * Judge the claim against the registry.
 *
 * `registry-silent` is the failure this plugin exists for: the panel says the domain is yours and
 * the registry has never heard of it. It is not "probably fine" — it means there is nothing to
 * own yet, and the only correct move is to stop waiting and act.
 */
export declare function verdict(facts: DomainFacts, claimed?: string | null): Verdict;
/**
 * A watched domain, as the merge helper sees it.
 *
 * Declared here — in the dependency-free module — rather than in `store.ts`, so the merge rule can
 * be tested without pulling zod and the storage facility into the test process. `store.ts`'s zod
 * schema is the runtime authority and conforms to this shape; the compiler holds the two together.
 */
export interface Watched {
    domain: string;
    note?: string;
    addedAt: string;
    checkedAt?: string;
    registered?: boolean;
    registrar?: string;
    createdAt?: string;
    expiresAt?: string;
    nameservers?: string[];
    statuses?: string[];
    /** The last query's failure, kept so a network error is never read as "not registered". */
    lastError?: string;
}
/**
 * Merge a patch into an existing record. **One helper, used by every writer.**
 *
 * A `put` that replaces the record silently wipes fields the caller did not mention — the exact
 * shape of bug A10, where a selection write took the project link with it. Re-checking a domain
 * must not erase the operator's note, and adding a note must not erase the last registry answer.
 * So writes are read-then-merge, always, and `undefined` means "leave it".
 */
export declare function mergeWatched(existing: Watched | null, patch: Partial<Watched>): Watched;
