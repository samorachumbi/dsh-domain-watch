/**
 * dsh-domain-watch host half (cordis plugin body).
 *
 * Owns the watched-domain store, the registry queries behind the agent tools, and one
 * host-rendered page at `<origin>/domain-watch/ui`. Everything is host-plane.
 *
 * There is no client half on purpose. The board lives in its own browser tab, which keeps the
 * harness UI uncrowded and — because no `dsh.client` manifest exists — keeps `dsh-client-modules`
 * from trying to compose a bundle that would then have to be built and shipped.
 *
 * Export shape: function/namespace plugin (name/inject/Config/apply, NO default — a stray
 * `export default` would collapse the module through the Loader's unwrapExports and drop
 * `inject`, which upstream shipped once and which aborts the boot).
 *
 * @module dsh-domain-watch
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only side-effect imports: these packages augment `Context` via
// `declare module '@deepseek-ai/cordis'`. Without their declarations the augmentation is
// invisible and `ctx.webServer` / `ctx.storageDomain` are type errors. Erased at runtime.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { Config, positive } from './config.ts'
import type { PluginConfig } from './config.ts'
import { domainWatchDomain, createStore } from './store.ts'
import type { DomainWatchDomainSpec } from './store.ts'
import { KENIC_GRACE } from './domain.ts'
import { createService } from './service.ts'
import { ROUTE_PREFIX, createHandlers } from './page.ts'
import { registerTools } from './tools.ts'
import { normalizeDomain } from './whois.ts'

export { Config }

export const name = 'dsh-domain-watch'

/** storageDomain: the watch list. webServer: the registry API and the board. `tools` is optional. */
export const inject = ['storageDomain', 'webServer']

export function apply(ctx: Context, config: PluginConfig): void {
  // Stay defensive: a direct programmatic apply (probe, test harness) must not trip over a
  // missing field, so every value falls back rather than trusting the schema to have run.
  const suspendAfter = positive(config?.suspendAfterDays, KENIC_GRACE.suspendAfter)
  const deleteAfter = positive(config?.deleteAfterDays, KENIC_GRACE.deleteAfter)
  const warnWithinDays = positive(config?.warnWithinDays, 60)
  const timeoutMs = positive(config?.timeoutMs, 15_000)

  const domainPromise: Promise<Domain<DomainWatchDomainSpec>> = ctx.storageDomain.open(domainWatchDomain)

  ctx.effect(() => async () => {
    try {
      const domain = await domainPromise
      await domain.close()
    } catch {
      // A failed open has nothing to close, and teardown must never throw.
    }
  }, 'domain-watch.domainClose')

  const store = createStore({ domainPromise })
  const service = createService({
    store,
    grace: { suspendAfter: suspendAfter, deleteAfter: deleteAfter },
    warnWithinDays,
    timeoutMs,
  })

  // Seed from config WITHOUT a network query. A whois round-trip per domain during `apply` would
  // make boot depend on a registry being reachable — a plugin that fails to start because a
  // registry is slow is worse than one that starts with an unchecked row, and the row says so.
  const seeded = Array.isArray(config?.domains) ? config.domains : []
  if (seeded.length > 0) {
    void (async () => {
      try {
        for (const raw of seeded) {
          const domain = normalizeDomain(String(raw))
          if (domain === '') continue
          if ((await store.get(domain)) === null) await store.put({ domain })
        }
      } catch {
        // Seeding is a convenience; never let it take the boot down.
      }
    })()
  }

  const handlers = createHandlers(service)
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: (req, res) => handlers.handle(req, res),
  })
  ctx.effect(() => () => dispose(), 'domain-watch.routes')

  registerTools(ctx, { service })
}
