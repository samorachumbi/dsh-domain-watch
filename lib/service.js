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
export function createService({ store, grace, warnWithinDays, timeoutMs }) {
    /**
     * Ask the registry about one domain.
     *
     * `claimed` is what a vendor's panel told the operator. Passing it is what turns this from a
     * lookup into a **judgement**, and it is the whole reason the plugin exists.
     */
    const check = async (input, claimed, now = new Date()) => {
        const domain = normalizeDomain(input);
        const registry = registryFor(domain);
        if (registry === null) {
            return failure(domain, `No registry is known for this TLD, so no answer was obtained. Add it to REGISTRY_BY_SUFFIX ` +
                `(IANA root database) rather than guessing — asking the wrong registry for a name returns ` +
                `"no match", which reads as available and is not.`);
        }
        let raw;
        try {
            raw = await whoisQuery(domain, registry.server, timeoutMs);
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
    return { check, checkAndRecord, add, remove, board };
}
