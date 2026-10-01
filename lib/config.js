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
export const Config = z.object({
    suspendAfterDays: z.number().default(14),
    deleteAfterDays: z.number().default(90),
    warnWithinDays: z.number().default(60),
    timeoutMs: z.number().default(15_000),
    domains: z.array(z.string()).default([]),
});
/** A config number that is finite and positive, else the fallback. */
export function positive(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
