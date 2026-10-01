/**
 * Plugin config. Deployment-varying values live here rather than in code, so a profile's
 * `cordis.yml` can retune them without a rebuild.
 *
 * The grace windows are configurable because they are **registry policy, not universal law**.
 * The defaults are KENIC's, read from the `.ke` Third Level Policy on 2026-10-01 (suspend 14 days
 * after expiry, delete 90 days after). A `.com` behaves differently, and a plugin that hard-coded
 * one registry's rules while claiming to answer for any TLD would be lying quietly.
 *
 * @module dsh-domain-watch/config
 */
import z from '@deepseek-ai/schemastery';
export interface PluginConfig {
    /** Days after expiry before the name stops resolving. Default: KENIC's 14. */
    suspendAfterDays: number;
    /** Days after expiry before anyone else may register it. Default: KENIC's 90. */
    deleteAfterDays: number;
    /** Warn this many days before expiry. */
    warnWithinDays: number;
    /** Per-query whois timeout in milliseconds. */
    timeoutMs: number;
    /** Domains to watch. Seeds the store on first run; the tools add to it afterwards. */
    domains: string[];
}
export declare const Config: z<PluginConfig>;
/** A config number that is finite and positive, else the fallback. */
export declare function positive(value: unknown, fallback: number): number;
