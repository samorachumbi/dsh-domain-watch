/**
 * The watched-domain store: one table, keyed by the normalised domain itself.
 *
 * The domain name IS the id. A surrogate key would let two rows claim the same name, and the whole
 * point of this plugin is that there is exactly one authority per name.
 *
 * Every field except `domain` and `addedAt` is optional, deliberately: a required field fails every
 * record written before it existed with `invalid-record`, and the domain then refuses to open. The
 * version stays 1 for the same reason — bumping it makes the medium, already stamped, reject at
 * open, i.e. the plugin would refuse to start on the store it created.
 *
 * @module dsh-domain-watch/store
 */
import z from 'zod';
import { type Domain } from '@deepseek-ai/dsh-storage-domain';
import { mergeWatched, type Watched as WatchedShape } from './domain.ts';
export { mergeWatched };
export declare const WatchedSchema: z.ZodObject<{
    domain: z.ZodString;
    note: z.ZodOptional<z.ZodString>;
    addedAt: z.ZodString;
    checkedAt: z.ZodOptional<z.ZodString>;
    registered: z.ZodOptional<z.ZodBoolean>;
    registrar: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodOptional<z.ZodString>;
    expiresAt: z.ZodOptional<z.ZodString>;
    nameservers: z.ZodOptional<z.ZodArray<z.ZodString>>;
    statuses: z.ZodOptional<z.ZodArray<z.ZodString>>;
    lastError: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** The schema is the runtime authority; the compiler checks it against the pure shape. */
export type Watched = z.infer<typeof WatchedSchema> & WatchedShape;
export declare const domainWatchDomain: {
    name: string;
    version: number;
    global: {
        schema: z.ZodObject<{
            updatedAt: z.ZodString;
        }, z.core.$strip>;
        initial: {
            updatedAt: string;
        };
    };
    tables: {
        watched: {
            valueSchema: z.ZodObject<{
                domain: z.ZodString;
                note: z.ZodOptional<z.ZodString>;
                addedAt: z.ZodString;
                checkedAt: z.ZodOptional<z.ZodString>;
                registered: z.ZodOptional<z.ZodBoolean>;
                registrar: z.ZodOptional<z.ZodString>;
                createdAt: z.ZodOptional<z.ZodString>;
                expiresAt: z.ZodOptional<z.ZodString>;
                nameservers: z.ZodOptional<z.ZodArray<z.ZodString>>;
                statuses: z.ZodOptional<z.ZodArray<z.ZodString>>;
                lastError: z.ZodOptional<z.ZodString>;
            }, z.core.$strip>;
        };
    };
};
export type DomainWatchDomainSpec = typeof domainWatchDomain;
export interface StoreDeps {
    domainPromise: Promise<Domain<DomainWatchDomainSpec>>;
}
export declare function createStore({ domainPromise }: StoreDeps): {
    list: () => Promise<Watched[]>;
    get: (domain: string) => Promise<Watched | null>;
    put: (patch: Partial<Watched> & {
        domain: string;
    }) => Promise<Watched>;
    remove: (domain: string) => Promise<boolean>;
};
export type WatchStore = ReturnType<typeof createStore>;
