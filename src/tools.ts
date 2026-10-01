/**
 * The agent tools. Four, all thin: every decision lives in `service.ts`.
 *
 * `domain_check` is the one that matters. Its `claimed` parameter is what makes it more than a
 * lookup — it is the vendor's assertion, and the answer names the disagreement with the registry
 * instead of averaging the two into a comfortable middle.
 *
 * @module dsh-domain-watch/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { CheckResult, DomainWatchService } from './service.ts'

const NULLABLE_STRING = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const

const checkOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    domain: { type: 'string', required: true },
    registered: { type: 'boolean', required: true },
    registrar: { type: 'string', required: true },
    createdAt: { type: 'string', required: true },
    expiresAt: { type: 'string', required: true },
    daysRemaining: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
    phase: { type: 'string', required: true },
    transferLocked: { type: 'boolean', required: true },
    nameservers: { type: 'array', required: true, items: { type: 'string' } },
    statuses: { type: 'array', required: true, items: { type: 'string' } },
    verdict: { type: 'string', required: true },
    headline: { type: 'string', required: true },
    alarming: { type: 'boolean', required: true },
    error: { type: 'string', required: true },
    checkedAt: { type: 'string', required: true },
  },
} as const

const watchItemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    domain: { type: 'string', required: true },
    note: { type: 'string', required: true },
    registrar: { type: 'string', required: true },
    expiresAt: { type: 'string', required: true },
    daysRemaining: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
    phase: { type: 'string', required: true },
    transferLocked: { type: 'boolean', required: true },
    stale: { type: 'boolean', required: true },
    lastError: { type: 'string', required: true },
  },
} as const

const listOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    count: { type: 'integer', required: true },
    items: { type: 'array', required: true, items: watchItemSchema },
    text: { type: 'string', required: true },
  },
} as const

const VERDICT_NOTE = {
  confirmed: 'Both agree.',
  'registry-ahead': 'The registry already has it; the panel is a lagging cache. Do not re-order.',
  'registry-silent': 'THE PANEL SAYS IT IS YOURS AND THE REGISTRY HAS NO RECORD. You do not own it.',
  'in-progress': 'Neither shows it registered. The order has not landed.',
  'registry-only': 'No claim was given, so this is the registry answer alone.',
} as const

function renderCheck(_args: unknown, value: CheckResult) {
  const lines = [
    `${value.domain} — ${value.verdict}`,
    value.headline,
    '',
    `registry:      ${value.error !== '' ? 'NOT ASKED — ' + value.error : value.registered ? 'REGISTERED' : 'NO RECORD'}`,
    `registrar:     ${value.registrar || '—'}`,
    `created:       ${value.createdAt || '—'}`,
    `expires:       ${value.expiresAt || '—'}`,
    `days remain:   ${value.daysRemaining === null ? '—' : value.daysRemaining}`,
    `phase:         ${value.phase}`,
    `transfer lock: ${value.transferLocked ? 'yes' : 'no'}`,
  ]
  if (value.nameservers.length > 0) lines.push(`nameservers:   ${value.nameservers.join(', ')}`)
  const note = VERDICT_NOTE[value.verdict]
  if (note !== undefined) lines.push('', `why: ${note}`)
  if (value.error !== '') lines.push('', 'NOTE: a failed query is NOT a missing domain.')
  return [{ type: 'text' as const, text: lines.join('\n') }]
}

export interface ToolDeps {
  service: DomainWatchService
}

export function buildTools({ service }: ToolDeps) {
  const renderList = async () => {
    const rows = await service.board()
    const items = rows.map((r) => ({
      domain: r.domain,
      note: r.note ?? '',
      registrar: r.registrar ?? '',
      expiresAt: r.expiresAt ?? '',
      daysRemaining: r.daysRemaining,
      phase: r.phase,
      transferLocked: (r.statuses ?? []).some((s) => s.toLowerCase().includes('transferprohibited')),
      stale: r.stale,
      lastError: r.lastError ?? '',
    }))
    const text = items.length === 0
      ? 'No domains are being watched yet. Add one with domain_watch_add.'
      : items
          .map((i) => {
            const when = i.daysRemaining === null ? 'expiry unknown' : `${i.daysRemaining} days`
            const stale = i.stale ? ' (never checked)' : ''
            const bad = i.lastError !== '' ? ` — LAST QUERY FAILED: ${i.lastError}` : ''
            return `${i.domain}  ${when}  [${i.phase}]${stale}${bad}`
          })
          .join('\n')
    return { count: items.length, items, text }
  }

  // Typed from renderList itself rather than hand-written, so the empty case cannot drift out of
  // step with the real one — the mismatch that made this fail its first typecheck.
  type ListResult = Awaited<ReturnType<typeof renderList>>
  const notFound = (domain: string): ListResult => ({
    count: 0,
    items: [],
    text: `Nothing is being watched for ${domain}.`,
  })

  return [
    defineTool({
      name: 'domain_check',
      description:
        'Ask the REGISTRY whether a domain is really registered — registrar of record, creation and expiry dates, days remaining, transfer lock. Pass `claimed` with whatever a registrar or hosting panel told you (for example "active", "paid", "pending") and the answer will name any disagreement instead of averaging it. A vendor dashboard is a cache: it has said "paid" while the registry held no record at all, and "pending" while the registry already had the name. A query failure is reported as an error and never as "not registered".',
      parameters: {
        domain: { type: 'string', required: true, description: 'The domain, e.g. example.co.ke. A scheme, path or leading www. is stripped.' },
        claimed: { ...NULLABLE_STRING, description: 'Optional: what a vendor panel says about it, e.g. "active", "paid", "pending".' },
      },
      output: { schema: checkOutputSchema, render: renderCheck },
      execute: async (args: { domain: string; claimed?: string | null }) =>
        service.check(args.domain, args.claimed ?? null),
    }),

    defineTool({
      name: 'domain_watch_add',
      description:
        'Start watching a domain. Checks the registry immediately and remembers the answer, so expiry can be tracked without asking again. Watching is what makes an expiry date the operator\'s problem BEFORE it becomes one.',
      parameters: {
        domain: { type: 'string', required: true, description: 'The domain to watch.' },
        note: { type: 'string', description: 'Optional note: who it belongs to, or what it is for.' },
      },
      output: { schema: listOutputSchema, render: (_a: unknown, v: { text: string }) => [{ type: 'text' as const, text: v.text }] },
      execute: async (args: { domain: string; note?: string }) => {
        await service.add(args.domain, args.note)
        return renderList()
      },
    }),

    defineTool({
      name: 'domain_watch_remove',
      description: 'Stop watching a domain. Removes the record only — it never touches the domain itself.',
      parameters: {
        domain: { type: 'string', required: true, description: 'The domain to stop watching.' },
      },
      output: { schema: listOutputSchema, render: (_a: unknown, v: { text: string }) => [{ type: 'text' as const, text: v.text }] },
      execute: async (args: { domain: string }) => {
        const removed = await service.remove(args.domain)
        if (!removed) return notFound(args.domain)
        return renderList()
      },
    }),

    defineTool({
      name: 'domain_watch_list',
      description:
        'Every watched domain, soonest to expire first, with days remaining, registrar, and any query failure. Reads the remembered registry answers and recomputes the countdown live, so this is cheap and can be called freely.',
      parameters: {},
      output: { schema: listOutputSchema, render: (_a: unknown, v: { text: string }) => [{ type: 'text' as const, text: v.text }] },
      execute: async () => renderList(),
    }),
  ]
}

/** Optional-dependency style: a profile with no tool registry gets no tools, not a failed boot. */
export function registerTools(ctx: Context, deps: ToolDeps): void {
  ctx.inject(['tools'], (toolCtx: Context) => {
    for (const tool of buildTools(deps)) toolCtx.tools.register(tool)
  })
}

