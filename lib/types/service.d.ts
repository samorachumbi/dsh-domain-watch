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
}
export declare function createService({ store, grace, warnWithinDays, timeoutMs }: ServiceDeps): {
    check: (input: string, claimed?: string | null, now?: Date) => Promise<CheckResult>;
    checkAndRecord: (input: string, claimed?: string | null) => Promise<CheckResult>;
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
};
export type DomainWatchService = ReturnType<typeof createService>;
