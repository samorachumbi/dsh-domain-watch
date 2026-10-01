/**
 * Real registry replies, captured 2026-10-01. Not invented.
 *
 * These are verbatim KENIC answers — one for a name that exists, one for a name that does not, and
 * one for a name carrying a transfer lock. The suite has no network by design, so the fixtures ARE
 * the registry as far as these tests are concerned; that makes them the most important file here,
 * and the reason they are quoted rather than paraphrased.
 */

export const KENIC_REGISTERED = `Domain Name: itikia.co.ke
Registry Domain ID: 2164505-KENIC
Updated Date: 
Creation Date: 2026-10-01T17:31:12Z
Registry Expiry Date: 2027-10-01T17:31:15Z
Registrar Registration Expiration Date: 2027-10-01T17:31:15Z
Registrar: Truehost AI
Registrar Street Address: Ryanada Place, Thika Superhighway, Highpoint, Juja., P.O. Box 14460 - 00400, Nairobi.
Registrar City: Nairobi
Registrar Phone: +254207903111
Registrar Email: accounts@truehost.cloud
Domain Status: active https://icann.org/epp#active
Name Server: ns3.cloudoon.org
Name Server: ns2.cloudoon.net
Name Server: ns1.cloudoon.com
DNSSEC: unsigned
>>> Last update of WHOIS database: 2026-10-01T17:30:04.481Z <<<
`

export const KENIC_NOT_FOUND = `Domain Name: itikia.co.ke
The queried object does not exist: No Object Found
>>> Last update of WHOIS database: 2026-10-01T16:24:13.544Z <<<
`

export const KENIC_LOCKED = `Domain Name: jibu.co.ke
Registry Domain ID: 2145651-KENIC
Creation Date: 2026-09-15T11:19:48Z
Registry Expiry Date: 2027-09-15T11:19:51Z
Registrar: Truehost AI
Domain Status: active https://icann.org/epp#active
Domain Status: clientTransferProhibited https://icann.org/epp#clientTransferProhibited
Name Server: ns3.cloudoon.org
DNSSEC: unsigned
`
