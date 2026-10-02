/**
 * The semantic layer, shared by the agent tools and the HTTP surface.
 *
 * The routes own transport concerns and the tools own argument shapes; every decision about what a
 * registry answer MEANS lives here, once, so a page and a tool can never disagree about whether a
 * domain is in trouble.
 *
 * @module dsh-domain-watch/service
 */
import { type GraceWindows, type LifecyclePhase, type VerdictCode } from './domain.ts';
import type { WatchStore } from './store.ts';
import { type Activity, type Summary } from './summary.ts';
export interface CheckResult {
    domain: string;
    registered: boolean;
    registrar: string;
    createdAt: string;
    expiresAt: string;
    daysRemaining: number | null;
    daysUntilSuspended: number | null;
    daysUntilDeletable: number | null;
    phase: LifecyclePhase;
    transferLocked: boolean;
    nameservers: string[];
    statuses: string[];
    verdict: VerdictCode;
    headline: string;
    alarming: boolean;
    /** Non-empty only when the question could not be asked. NEVER means "not registered". */
    error: string;
    checkedAt: string;
}
export interface ServiceDeps {
    store: WatchStore;
    grace: GraceWindows;
    warnWithinDays: number;
    timeoutMs: number;
    /**
     * The transport, injectable so a test can make it THROW.
     *
     * That is not decoration: the guarantee that the "checking…" light always clears is a `finally`,
     * and a `finally` nobody has watched run under failure is an assumption. Defaults to the real
     * whois client.
     */
    query?: (domain: string, server: string, timeoutMs: number) => Promise<string>;
}
export declare function createService({ store, grace, warnWithinDays, timeoutMs, query }: ServiceDeps): {
    check: (input: string, claimed?: string | null, now?: Date) => Promise<CheckResult>;
    checkAndRecord: (input: string, claimed?: string | null) => Promise<CheckResult>;
    recheckAll: () => Promise<{
        domain: string;
        ok: boolean;
        error: string;
    }[]>;
    add: (input: string, note?: string) => Promise<CheckResult>;
    remove: (input: string) => Promise<boolean>;
    board: (now?: Date) => Promise<{
        daysRemaining: number | null;
        daysUntilDeletable: number | null;
        phase: LifecyclePhase;
        stale: boolean;
        domain: string;
        addedAt: string;
        note?: string;
        checkedAt?: string;
        registered?: boolean;
        registrar?: string;
        createdAt?: string;
        expiresAt?: string;
        nameservers?: string[];
        statuses?: string[];
        lastError?: string;
    }[]>;
    summary: () => Promise<Summary>;
    activity: () => Activity;
};
export type DomainWatchService = ReturnType<typeof createService>;
