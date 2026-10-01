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

import z from 'zod'
import { defineDomain, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { normalizeDomain } from './whois.ts'
import { mergeWatched, type Watched as WatchedShape } from './domain.ts'

export { mergeWatched }

export const WatchedSchema = z.object({
  domain: z.string().min(1).max(253),
  note: z.string().max(500).optional(),
  addedAt: z.string(),
  /** When the registry was last asked. Absent means never — the age of the answer matters. */
  checkedAt: z.string().optional(),
  registered: z.boolean().optional(),
  registrar: z.string().max(200).optional(),
  createdAt: z.string().max(64).optional(),
  expiresAt: z.string().max(64).optional(),
  nameservers: z.array(z.string().max(253)).max(20).optional(),
  statuses: z.array(z.string().max(64)).max(20).optional(),
  /** The last query's failure, kept so a network error is never mistaken for "not registered". */
  lastError: z.string().max(500).optional(),
})

/** The schema is the runtime authority; the compiler checks it against the pure shape. */
export type Watched = z.infer<typeof WatchedSchema> & WatchedShape

const GlobalSchema = z.object({
  updatedAt: z.string(),
})

export const domainWatchDomain = defineDomain({
  name: 'domain_watch',
  version: 1,
  global: {
    schema: GlobalSchema,
    initial: { updatedAt: '' },
  },
  tables: {
    watched: { valueSchema: WatchedSchema },
  },
})

export type DomainWatchDomainSpec = typeof domainWatchDomain

export interface StoreDeps {
  domainPromise: Promise<Domain<DomainWatchDomainSpec>>
}

export function createStore({ domainPromise }: StoreDeps) {
  const table = async () => (await domainPromise).table('watched')

  const list = async (): Promise<Watched[]> => [...(await table()).entries()].map(([, v]) => v)

  const get = async (domain: string): Promise<Watched | null> =>
    (await table()).get(normalizeDomain(domain)) ?? null

  const put = async (patch: Partial<Watched> & { domain: string }): Promise<Watched> => {
    const key = normalizeDomain(patch.domain)
    const merged = mergeWatched(await get(key), { ...patch, domain: key })
    await (await table()).put(key, merged)
    return merged
  }

  const remove = async (domain: string): Promise<boolean> => {
    const key = normalizeDomain(domain)
    if ((await get(key)) === null) return false
    await (await table()).delete(key)
    return true
  }

  return { list, get, put, remove }
}

export type WatchStore = ReturnType<typeof createStore>
