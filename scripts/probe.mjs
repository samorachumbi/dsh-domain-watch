/**
 * Live probe: ask a REAL registry through the built library.
 *
 * The unit tests run against recorded replies with no network, which proves the parsing. This
 * proves the half that recorded replies cannot: that the transport reaches the registry, that the
 * map picks the right server, and that a real answer survives the round trip.
 *
 * Run it after a build. It leaves nothing behind — no store, no server.
 */
import { normalizeDomain, registryFor, whoisQuery } from '../lib/whois.js'
import { lifecycle, parseWhois, verdict, KENIC_GRACE } from '../lib/domain.js'

const targets = process.argv.slice(2)
const domains = targets.length > 0 ? targets : ['itikia.co.ke', 'this-name-is-free-4f9a2c.co.ke']

let bad = 0
for (const input of domains) {
  const domain = normalizeDomain(input)
  const reg = registryFor(domain)
  if (reg === null) {
    console.log(`??  ${domain}: no registry known — refusing to guess, which is the correct answer`)
    bad++
    continue
  }
  try {
    const raw = await whoisQuery(domain, reg.server, 15000)
    const facts = parseWhois(domain, raw)
    const life = lifecycle(facts.expiresAt, new Date(), KENIC_GRACE, 60)
    console.log(
      `${facts.registered ? 'YES' : ' NO'} ${domain.padEnd(34)} via ${reg.server}\n` +
        `      registrar=${facts.registrar ?? '—'} expires=${facts.expiresAt ?? '—'} ` +
        `days=${life.daysRemaining ?? '—'} phase=${life.phase} lock=${facts.transferLocked}\n` +
        `      verdict(claimed=paid) -> ${verdict(facts, 'paid').code}`,
    )
  } catch (err) {
    console.log(`ERR ${domain}: ${err.message}  <-- a failure must NEVER read as "not registered"`)
    bad++
  }
}
process.exit(bad === 0 ? 0 : 1)
