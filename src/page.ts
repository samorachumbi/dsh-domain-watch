/**
 * The host-rendered board at /domain-watch/ui.
 *
 * Server-rendered HTML with no client bundle: the page works with JavaScript off, cannot go stale
 * against a build step, and adds nothing to the harness UI. Expiry countdowns are computed per
 * request from the remembered registry answers, so the numbers move even when nobody clicks
 * anything — which is the point, because the failure being guarded against is time passing.
 *
 * @module dsh-domain-watch/page
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DomainWatchService } from './service.ts'
import type { Summary } from './summary.ts'

export const ROUTE_PREFIX = '/domain-watch'

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

const sendJson = (res: ServerResponse, status: number, value: unknown): void =>
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value, null, 2))

/** Same posture as the harness's own `/api` fence: cheap, and it closes the obvious hole. */
export function isLoopbackHost(req: IncomingMessage): boolean {
  const raw = req.headers.host
  if (raw === undefined) return false
  let host: string
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    if (end === -1) return false
    host = raw.slice(1, end)
  } else {
    const first = raw.indexOf(':')
    const last = raw.lastIndexOf(':')
    host = first === -1 || first !== last ? raw : raw.slice(0, first)
  }
  host = host.toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A phase is a colour AND a word: colour alone fails for anyone who cannot see the difference. */
const PHASE_LABEL: Record<string, string> = {
  active: 'active',
  expiring: 'expiring soon',
  'past-expiry': 'PAST EXPIRY',
  suspended: 'SUSPENDED',
  deletable: 'DELETABLE — anyone may take it',
  unknown: 'unknown',
}

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f6f7f9; --card: #ffffff; --ink: #14202c; --soft: #5b6b7c;
  --line: #dde3ea; --accent: #0b55bb; --ok: #1a7f4b; --warn: #a86400; --bad: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e141b; --card: #161e27; --ink: #e8eef5; --soft: #9aabbd;
    --line: #26313d; --accent: #6aa8ff; --ok: #4cc38a; --warn: #e0a83c; --bad: #ff6b60;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
p.sub { color: var(--soft); margin: 0 0 24px; font-size: 13.5px; }
table { width: 100%; border-collapse: collapse; background: var(--card);
  border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
th, td { text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--line); font-size: 13.5px; }
th { font-size: 11px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--soft); font-weight: 700; }
tr:last-child td { border-bottom: 0; }
td.name { font-weight: 650; }
td.dim { color: var(--soft); }
.pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
  border: 1px solid currentColor; }
.p-ok { color: var(--ok); } .p-warn { color: var(--warn); } .p-bad { color: var(--bad); }
.p-unknown { color: var(--soft); }
.bar { height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; margin-top: 6px; min-width: 90px; }
.bar > i { display: block; height: 100%; background: currentColor; }
.empty { background: var(--card); border: 1px dashed var(--line); border-radius: 12px; padding: 28px;
  color: var(--soft); text-align: center; }
a { color: var(--accent); }
footer { margin-top: 20px; color: var(--soft); font-size: 12.5px; }
code { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 1px 5px; font-size: 12.5px; }
`

function phaseClass(phase: string): string {
  if (phase === 'active') return 'p-ok'
  if (phase === 'expiring') return 'p-warn'
  if (phase === 'unknown') return 'p-unknown'
  return 'p-bad'
}

function renderBoard(rows: Awaited<ReturnType<DomainWatchService['board']>>, summary: Summary, now: Date): string {
  // The SAME summary the pill paints. One rule, one place: a status re-derived in the page would
  // drift from the one on the bubble, and the two would disagree the first time either changed.
  const tone = summary.level === 'alarm' ? 'var(--bad)'
    : summary.level === 'attention' ? 'var(--warn)'
      : summary.level === 'calm' ? 'var(--ok)' : 'var(--soft)'
  const banner = '<p class="sub" style="color:' + tone + '"><strong>' +
    esc(summary.label) + (summary.glyph ? ' ' + summary.glyph : '') + '</strong> — ' +
    esc(summary.action) + '</p>'

  const body = rows.length === 0
    ? '<div class="empty">Nothing is being watched yet.<br>Add one with <code>domain_watch_add</code>, ' +
      'or ask the agent to check a domain.</div>'
    : '<table><thead><tr><th>Domain</th><th>Registrar</th><th>Expires</th><th>Remaining</th>' +
      '<th>State</th><th>Lock</th></tr></thead><tbody>' +
      rows.map((r) => {
        const days = r.daysRemaining
        const pct = days === null ? 0 : Math.max(2, Math.min(100, Math.round((days / 365) * 100)))
        const remaining = days === null
          ? '<span class="dim">unknown</span>'
          : '<span class="' + phaseClass(r.phase) + '">' + days + ' days</span>' +
            '<span class="bar"><i style="width:' + pct + '%"></i></span>'
        const stale = r.stale ? ' <span class="dim">(never checked)</span>' : ''
        const err = (r.lastError ?? '') !== ''
          ? '<div class="dim" style="color:var(--bad)">last query failed: ' + esc(r.lastError ?? '') + '</div>'
          : ''
        const lock = (r.statuses ?? []).some((s) => s.toLowerCase().includes('transferprohibited'))
          ? '<span class="p-ok">locked</span>'
          : '<span class="dim">—</span>'
        return '<tr>' +
          '<td class="name">' + esc(r.domain) + (r.note !== undefined && r.note !== '' ? '<div class="dim">' + esc(r.note) + '</div>' : '') + '</td>' +
          '<td>' + esc(r.registrar ?? '—') + '</td>' +
          '<td class="dim">' + esc(r.expiresAt ?? '—') + '</td>' +
          '<td>' + remaining + '</td>' +
          '<td><span class="pill ' + phaseClass(r.phase) + '">' + (PHASE_LABEL[r.phase] ?? r.phase) + '</span>' + stale + err + '</td>' +
          '<td>' + lock + '</td>' +
          '</tr>'
      }).join('') +
      '</tbody></table>'

  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Domain watch</title><style>' + CSS + '</style></head><body><main>' +
    '<h1>Domain watch</h1>' +
    '<p class="sub">Read from the REGISTRY, never from a registrar\'s dashboard, which is a cache ' +
    'and is wrong in both directions. Rendered ' + esc(now.toISOString()) + '.</p>' +
    banner + body +
    '<footer>The registry is the authority. A failed query is shown as a failure and never as ' +
    '"not registered" — those two are the difference between a working domain and a lost one.</footer>' +
    '</main></body></html>'
}

export function createHandlers(service: DomainWatchService) {
  return {
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      if (!isLoopbackHost(req)) {
        sendJson(res, 403, { ok: false, error: 'loopback-only' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const path = url.pathname

      try {
        if (req.method === 'GET' && (path === ROUTE_PREFIX || path === ROUTE_PREFIX + '/ui')) {
          const rows = await service.board()
          send(res, 200, 'text/html; charset=utf-8', renderBoard(rows, await service.summary(), new Date()))
          return
        }
        if (req.method === 'GET' && path === ROUTE_PREFIX + '/state') {
          // `summary` is derived host-side so the pill and the board can never disagree about what
          // is wrong; the pill paints `summary` and reads nothing else.
          sendJson(res, 200, {
            ok: true,
            summary: await service.summary(),
            domains: await service.board(),
          })
          return
        }
        if (req.method === 'GET' && path === ROUTE_PREFIX + '/check') {
          const domain = url.searchParams.get('domain')
          if (domain === null || domain === '') {
            sendJson(res, 400, { ok: false, error: 'domain-required' })
            return
          }
          const claimed = url.searchParams.get('claimed')
          const result = await service.checkAndRecord(domain, claimed)
          if (url.searchParams.get('json') === '1') {
            sendJson(res, 200, { ok: true, result })
            return
          }
          res.writeHead(303, { location: ROUTE_PREFIX + '/ui' })
          res.end()
          return
        }
        if (path === ROUTE_PREFIX + '/recheck' && (req.method === 'POST' || req.method === 'GET')) {
          // What the presence pill's click calls. POST, because it is an ACTION with a side effect;
          // GET is accepted as well so the route can be exercised from a browser or curl while
          // debugging, which is how every other route in this plugin is checked by hand.
          const results = await service.recheckAll()
          sendJson(res, 200, { ok: true, checked: results.length, results })
          return
        }
        sendJson(res, 404, { ok: false, error: 'no-such-route', path })
      } catch (err) {
        sendJson(res, 500, { ok: false, error: (err as Error).message })
      }
    },
  }
}

export type DomainWatchHandlers = ReturnType<typeof createHandlers>
