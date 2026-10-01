/**
 * The semantic layer, shared by the agent tools and the HTTP surface.
 *
 * The routes own transport concerns and the tools own argument shapes; every decision about what a
 * registry answer MEANS lives here, once, so a page and a tool can never disagree about whether a
 * domain is in trouble.
 *
 * @module dsh-domain-watch/service
 */
import { lifecycle, parseWhois, verdict } from "./domain.js";
import { normalizeDomain, registryFor, whoisQuery } from "./whois.js";
import { summarize } from "./summary.js";
function failure(domain, error) {
    return {
        domain,
        registered: false,
        registrar: '',
        createdAt: '',
        expiresAt: '',
        daysRemaining: null,
        daysUntilSuspended: null,
        daysUntilDeletable: null,
        phase: 'unknown',
        transferLocked: false,
        nameservers: [],
        statuses: [],
        // The verdict for an unaskable question is deliberately NOT `in-progress`: nothing was learned.
        verdict: 'registry-only',
        headline: error,
        alarming: false,
        error,
        checkedAt: new Date().toISOString(),
    };
}
export function createService({ store, grace, warnWithinDays, timeoutMs, query = whoisQuery }) {
    /**
     * Ask the registry about one domain.
     *
     * `claimed` is what a vendor's panel told the operator. Passing it is what turns this from a
     * lookup into a **judgement**, and it is the whole reason the plugin exists.
     */
    /**
     * Domains currently being asked about, and when each request started.
     *
     * This exists so the pill's "working" state is a FACT rather than an inference from a timestamp
     * moving. An acknowledgement that is produced by guessing is worse than none: it fires late, or
     * when nothing happened at all.
     */
    const inFlight = new Map();
    let lastResult = null;
    /** What is in flight now; oldest first, so a burst names the one that started first. */
    const activity = () => {
        if (inFlight.size === 0)
            return { busy: false, domain: null, since: null };
        const oldest = [...inFlight.entries()].sort((a, b) => a[1].localeCompare(b[1]))[0];
        return { busy: true, domain: oldest?.[0] ?? null, since: oldest?.[1] ?? null };
    };
    /**
     * Ask the registry, wrapped so the pill can see it happen.
     *
     * The in-flight marker is set BEFORE the query and cleared in a `finally`, so a throw, a timeout
     * or an early return all clear it. A stuck "checking…" light would be the one state a user cannot
     * distinguish from a hung plugin.
     */
    const check = async (input, claimed, now = new Date()) => {
        const domain = normalizeDomain(input);
        inFlight.set(domain, new Date().toISOString());
        try {
            const result = await runCheck(domain, claimed, now);
            lastResult = { domain, ok: result.error === '', at: result.checkedAt };
            return result;
        }
        finally {
            inFlight.delete(domain);
        }
    };
    const runCheck = async (domain, claimed, now) => {
        const registry = registryFor(domain);
        if (registry === null) {
            return failure(domain, `No registry is known for this TLD, so no answer was obtained. Add it to REGISTRY_BY_SUFFIX ` +
                `(IANA root database) rather than guessing — asking the wrong registry for a name returns ` +
                `"no match", which reads as available and is not.`);
        }
        let raw;
        try {
            raw = await query(domain, registry.server, timeoutMs);
        }
        catch (err) {
            // A network failure is NOT "available". Saying so would be the single most expensive
            // sentence this plugin could emit.
            return failure(domain, `${registry.server} could not be asked: ${err.message}`);
        }
        const facts = parseWhois(domain, raw);
        const life = lifecycle(facts.expiresAt, now, grace, warnWithinDays);
        const judge = verdict(facts, claimed);
        return {
            domain,
            registered: facts.registered,
            registrar: facts.registrar ?? '',
            createdAt: facts.createdAt ?? '',
            expiresAt: facts.expiresAt ?? '',
            daysRemaining: life.daysRemaining,
            daysUntilSuspended: life.daysUntilSuspended,
            daysUntilDeletable: life.daysUntilDeletable,
            phase: life.phase,
            transferLocked: facts.transferLocked,
            nameservers: facts.nameservers,
            statuses: facts.statuses,
            verdict: judge.code,
            headline: judge.headline,
            alarming: judge.alarming,
            error: '',
            checkedAt: new Date().toISOString(),
        };
    };
    /** Check and remember. The registry answer is cached; `daysRemaining` is always recomputed live. */
    const checkAndRecord = async (input, claimed) => {
        const result = await check(input, claimed);
        await store.put({
            domain: result.domain,
            checkedAt: result.checkedAt,
            registered: result.registered,
            registrar: result.registrar,
            createdAt: result.createdAt,
            expiresAt: result.expiresAt,
            nameservers: result.nameservers,
            statuses: result.statuses,
            lastError: result.error,
        });
        return result;
    };
    /** The board: stored facts, aged against the clock now. No network. */
    const board = async (now = new Date()) => {
        const watched = await store.list();
        return watched
            .map((w) => {
            const life = lifecycle(w.expiresAt ?? null, now, grace, warnWithinDays);
            return {
                ...w,
                daysRemaining: life.daysRemaining,
                daysUntilDeletable: life.daysUntilDeletable,
                phase: w.lastError !== undefined && w.lastError !== '' ? 'unknown' : life.phase,
                stale: w.checkedAt === undefined,
            };
        })
            .sort((a, b) => {
            const av = a.daysRemaining ?? Number.MAX_SAFE_INTEGER;
            const bv = b.daysRemaining ?? Number.MAX_SAFE_INTEGER;
            return av - bv;
        });
    };
    /** Add a domain to the watch list: one registry query, then remember it. */
    const add = async (input, note) => {
        const domain = normalizeDomain(input);
        if (note !== undefined && note !== '')
            await store.put({ domain, note });
        return checkAndRecord(domain);
    };
    /** Stop watching. Removes the RECORD only — it never touches the domain itself. */
    const remove = async (input) => store.remove(input);
    /** The pill's and the board's single source of truth. */
    const summary = async () => summarize(await board(), activity(), lastResult);
    return { check, checkAndRecord, add, remove, board, summary, activity };
}
