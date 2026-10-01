/**
 * Port-43 whois transport, and the map from a TLD to the registry that actually serves it.
 *
 * WHY THE MAP EXISTS, AND WHY AN UNKNOWN TLD IS AN ERROR RATHER THAN A GUESS.
 *
 * "Just run whois" is the mistake this plugin was written after. Verisign serves `.com` and
 * `.net`; it does NOT serve `.org`, `.io` or `.dev`. Query Verisign for one of those and it
 * answers "No match for DOMAIN" — which reads as *available* and is in fact *the wrong server
 * was asked*. That produced three false "not registered" lines in one sitting.
 *
 * A registry that is not in this map therefore returns an explicit error. **A wrong answer is
 * worse than no answer**, because the wrong answer is the one you act on: it is the difference
 * between registering a domain you needed and losing it.
 *
 * To add a TLD: find the server in the IANA database at
 * <https://www.iana.org/domains/root/db> and add it here. Do not infer it from a similar TLD.
 *
 * @module dsh-domain-watch/whois
 */
/** Longest suffix wins, so `.co.ke` is matched before `.ke`. */
export declare const REGISTRY_BY_SUFFIX: {
    readonly '.co.ke': "whois.kenic.or.ke";
    readonly '.or.ke': "whois.kenic.or.ke";
    readonly '.ke': "whois.kenic.or.ke";
    readonly '.com': "whois.verisign-grs.com";
    readonly '.net': "whois.verisign-grs.com";
    readonly '.org': "whois.pir.org";
    readonly '.io': "whois.nic.io";
};
export type RegistrySuffix = keyof typeof REGISTRY_BY_SUFFIX;
export interface RegistryLookup {
    server: string;
    suffix: string;
}
/** The registry that serves this name, or `null` when we do not know — never a guess. */
export declare function registryFor(domain: string): RegistryLookup | null;
/**
 * Normalise what a human pastes into the registrable name.
 *
 * Strips a scheme, a path, a port, a trailing dot and a leading `www.` — `www` is a hostname,
 * not a registration, and asking the registry about `www.example.com` returns nothing, which
 * would read as "not registered" for a domain that is fine.
 */
export declare function normalizeDomain(input: string): string;
export declare class WhoIsError extends Error {
    constructor(message: string);
}
/**
 * A raw port-43 query. The registry's own words, unparsed.
 *
 * A network failure throws — it must never be reported as "not registered". The two are
 * indistinguishable to a caller that only sees an empty string, and conflating them is how you
 * pay twice for a domain you already own.
 */
export declare function whoisQuery(domain: string, server: string, timeoutMs?: number): Promise<string>;
