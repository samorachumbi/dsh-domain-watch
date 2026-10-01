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

import { connect } from 'node:net'

/** Longest suffix wins, so `.co.ke` is matched before `.ke`. */
export const REGISTRY_BY_SUFFIX = {
  '.co.ke': 'whois.kenic.or.ke',
  '.or.ke': 'whois.kenic.or.ke',
  '.ke': 'whois.kenic.or.ke',
  '.com': 'whois.verisign-grs.com',
  '.net': 'whois.verisign-grs.com',
  '.org': 'whois.pir.org',
  '.io': 'whois.nic.io',
} as const

export type RegistrySuffix = keyof typeof REGISTRY_BY_SUFFIX

export interface RegistryLookup {
  server: string
  suffix: string
}

/** The registry that serves this name, or `null` when we do not know — never a guess. */
export function registryFor(domain: string): RegistryLookup | null {
  const suffixes = Object.keys(REGISTRY_BY_SUFFIX).sort((a, b) => b.length - a.length)
  for (const suffix of suffixes) {
    if (domain.toLowerCase().endsWith(suffix)) {
      return { server: REGISTRY_BY_SUFFIX[suffix as RegistrySuffix], suffix }
    }
  }
  return null
}

/**
 * Normalise what a human pastes into the registrable name.
 *
 * Strips a scheme, a path, a port, a trailing dot and a leading `www.` — `www` is a hostname,
 * not a registration, and asking the registry about `www.example.com` returns nothing, which
 * would read as "not registered" for a domain that is fine.
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase()
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  d = d.split('/')[0] ?? d
  d = d.split('@').pop() ?? d
  d = d.replace(/:\d+$/, '')
  d = d.replace(/\.$/, '')
  if (d.startsWith('www.')) d = d.slice(4)
  return d
}

export class WhoIsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WhoIsError'
  }
}

/**
 * A raw port-43 query. The registry's own words, unparsed.
 *
 * A network failure throws — it must never be reported as "not registered". The two are
 * indistinguishable to a caller that only sees an empty string, and conflating them is how you
 * pay twice for a domain you already own.
 */
export function whoisQuery(domain: string, server: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    const socket = connect({ host: server, port: 43 })

    const finish = (err: Error | null, text?: string): void => {
      if (settled) return
      settled = true
      socket.destroy()
      if (err) reject(err)
      else resolve(text ?? '')
    }

    socket.setTimeout(timeoutMs)
    socket.on('connect', () => socket.write(`${domain}\r\n`))
    socket.on('data', (block) => chunks.push(Buffer.from(block)))
    socket.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')))
    socket.on('timeout', () => finish(new WhoIsError(`${server} did not answer within ${timeoutMs}ms`)))
    socket.on('error', (err: Error) => finish(new WhoIsError(`${server}: ${err.message}`)))
  })
}
