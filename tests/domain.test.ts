/**
 * The pure logic: parsing a registry reply, ageing it, and judging a vendor's claim.
 *
 * The defect these tests exist to prevent is the one that cost money on 2026-10-01. A registrar's
 * panel showed an order as **paid and active** while the registry held **no record at all**, and
 * the customer — holding a receipt, an invoice number and a dashboard — owned nothing. Days later
 * the same panel said **Pending** for a domain the registry had already made `active`.
 *
 * So the tests below are written against the two halves of that: a claim must never be able to
 * override the registry, and a failed query must never be able to masquerade as "not registered".
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  KENIC_GRACE,
  classifyClaim,
  daysBetween,
  field,
  fieldAll,
  lifecycle,
  mergeWatched,
  parseWhois,
  verdict,
} from '../src/domain.ts'
import { normalizeDomain, registryFor } from '../src/whois.ts'
import { KENIC_LOCKED, KENIC_NOT_FOUND, KENIC_REGISTERED } from './fixtures.ts'

// --------------------------------------------------------------------------- normalisation

test('normalizeDomain strips what a human pastes, and www because www is not a registration', () => {
  assert.equal(normalizeDomain('  HTTPS://WWW.Itikia.CO.KE/path?x=1  '), 'itikia.co.ke')
  assert.equal(normalizeDomain('itikia.co.ke.'), 'itikia.co.ke')
  assert.equal(normalizeDomain('http://itikia.co.ke:8080'), 'itikia.co.ke')
  assert.equal(normalizeDomain('itikia.co.ke'), 'itikia.co.ke')
})

// --------------------------------------------------------------------------- registry map

test('the registry is chosen by longest suffix, and an unknown TLD is null rather than a guess', () => {
  assert.equal(registryFor('itikia.co.ke')?.server, 'whois.kenic.or.ke')
  assert.equal(registryFor('example.ke')?.server, 'whois.kenic.or.ke')
  assert.equal(registryFor('example.com')?.server, 'whois.verisign-grs.com')
  // The bug this encodes: asking Verisign about .io returns "no match", which READS as available.
  // A registry we do not know must be an error, never an answer.
  // .io IS in the map (whois.nic.io); an unlisted TLD is what must refuse.
  assert.equal(registryFor('example.io')?.server, 'whois.nic.io')
  assert.equal(registryFor('example.zz'), null)
  assert.equal(registryFor('example.co.za'), null)
})

test('.co.ke must not be answered by the .ke entry by accident', () => {
  assert.equal(registryFor('itikia.co.ke')?.suffix, '.co.ke')
  assert.equal(registryFor('itikia.ke')?.suffix, '.ke')
})

// --------------------------------------------------------------------------- parsing

test('a registered reply parses into facts', () => {
  const f = parseWhois('itikia.co.ke', KENIC_REGISTERED)
  assert.equal(f.registered, true)
  assert.equal(f.registrar, 'Truehost AI')
  assert.equal(f.createdAt, '2026-10-01T17:31:12Z')
  assert.equal(f.expiresAt, '2027-10-01T17:31:15Z')
  assert.deepEqual(f.nameservers, ['ns3.cloudoon.org', 'ns2.cloudoon.net', 'ns1.cloudoon.com'])
  assert.deepEqual(f.statuses, ['active'])
  assert.equal(f.transferLocked, false)
})

test('a "No Object Found" reply is NOT registered — even though it echoes the domain name', () => {
  const f = parseWhois('itikia.co.ke', KENIC_NOT_FOUND)
  assert.equal(f.registered, false)
  assert.equal(f.registrar, null)
  assert.equal(f.expiresAt, null)
})

test('a transfer lock is detected from the status list', () => {
  assert.equal(parseWhois('jibu.co.ke', KENIC_LOCKED).transferLocked, true)
})

test('field returns null rather than an empty string, so absence is one case', () => {
  assert.equal(field(KENIC_REGISTERED, 'Registrar'), 'Truehost AI')
  assert.equal(field(KENIC_REGISTERED, 'Not A Field'), null)
  // "Updated Date:" is present with an empty value in the real reply — that must read as absent.
  assert.equal(field(KENIC_REGISTERED, 'Updated Date'), null)
  assert.deepEqual(fieldAll(KENIC_REGISTERED, 'Name Server').length, 3)
})

// --------------------------------------------------------------------------- lifecycle

test('daysBetween counts whole days in both directions', () => {
  assert.equal(daysBetween(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-31T00:00:00Z')), 30)
  assert.equal(daysBetween(new Date('2026-10-31T00:00:00Z'), new Date('2026-10-01T00:00:00Z')), -30)
})

test('the lifecycle phases sit where KENIC puts them', () => {
  const expiry = '2027-10-01T12:00:00Z'
  const at = (iso: string) => lifecycle(expiry, new Date(iso), KENIC_GRACE, 60)

  assert.equal(at('2027-01-01T12:00:00Z').phase, 'active')
  assert.equal(at('2027-09-01T12:00:00Z').phase, 'expiring')
  // +14 days after expiry it stops resolving; +90 and anyone may take it.
  const past = at('2027-10-05T12:00:00Z')
  assert.equal(past.phase, 'past-expiry')
  assert.equal(past.daysUntilSuspended, 10)
  assert.equal(at('2027-10-20T12:00:00Z').phase, 'suspended')
  assert.equal(at('2028-02-01T12:00:00Z').phase, 'deletable')
})

test('an unparseable or absent expiry is unknown, never a guess', () => {
  assert.equal(lifecycle(null, new Date()).phase, 'unknown')
  assert.equal(lifecycle('not a date', new Date()).phase, 'unknown')
})

// --------------------------------------------------------------------------- the verdict

test('classifyClaim reads a panel the way a human does', () => {
  assert.equal(classifyClaim('Active'), 'registered')
  assert.equal(classifyClaim('paid'), 'registered')
  assert.equal(classifyClaim('Pending'), 'pending')
  assert.equal(classifyClaim('awaiting provisioning'), 'pending')
  assert.equal(classifyClaim(undefined), 'unknown')
  assert.equal(classifyClaim('  '), 'unknown')
})

test('THE ONE THAT COST MONEY: a panel claiming success over an empty registry is alarming', () => {
  const facts = parseWhois('itikia.co.ke', KENIC_NOT_FOUND)
  const v = verdict(facts, 'paid')
  assert.equal(v.code, 'registry-silent')
  assert.equal(v.alarming, true)
  assert.match(v.headline, /NO record/i)
})

test('the mirror image: a panel stuck on Pending over a registered name is NOT alarming', () => {
  const facts = parseWhois('itikia.co.ke', KENIC_REGISTERED)
  const v = verdict(facts, 'Pending')
  assert.equal(v.code, 'registry-ahead')
  assert.equal(v.alarming, false)
  assert.match(v.headline, /cache/i)
})

test('agreement, in-progress, and no-claim-at-all are all distinct', () => {
  const reg = parseWhois('itikia.co.ke', KENIC_REGISTERED)
  const gone = parseWhois('itikia.co.ke', KENIC_NOT_FOUND)
  assert.equal(verdict(reg, 'active').code, 'confirmed')
  assert.equal(verdict(gone, 'pending').code, 'in-progress')
  assert.equal(verdict(reg, null).code, 'registry-only')
})

test('verdict never depends on the claim alone — the registry always has the last word', () => {
  const gone = parseWhois('itikia.co.ke', KENIC_NOT_FOUND)
  for (const claim of ['active', 'paid', 'completed', 'live', 'success']) {
    assert.equal(verdict(gone, claim).code, 'registry-silent', `claim ${claim}`)
    assert.equal(verdict(gone, claim).alarming, true)
  }
})

// --------------------------------------------------------------------------- the A10 class

test('a patch must not wipe fields the caller did not mention', () => {
  const existing = mergeWatched(null, { domain: 'itikia.co.ke', note: 'the business domain' })
  // A registry re-check passes only the facts. If this replaced the record, the note would be gone.
  const after = mergeWatched(existing, { registered: true, registrar: 'Truehost AI' })
  assert.equal(after.note, 'the business domain')
  assert.equal(after.addedAt, existing.addedAt)
  assert.equal(after.registrar, 'Truehost AI')
  assert.equal(after.domain, 'itikia.co.ke')
})

test('undefined means leave it alone — it is not a clear', () => {
  const existing = mergeWatched(null, { domain: 'x.co.ke', note: 'keep me' })
  assert.equal(mergeWatched(existing, { note: undefined }).note, 'keep me')
})
