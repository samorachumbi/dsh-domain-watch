/**
 * Screenshot a JS-RENDERED page, after waiting for it to settle.
 *
 * WHY NOT `chrome --screenshot`. That flag fires at `load` + first paint. This plugin's pill polls
 * every second, so its first answer arrives *after* that moment — and the capture showed the
 * `connecting` state every time. Worse, `--virtual-time-budget` HANGS on a page with a repeating
 * interval: virtual time fast-forwards the timer forever and the budget never expires. Both were
 * observed on 2026-10-01, and both produce a screenshot that is *plausible and wrong*, which is the
 * expensive kind.
 *
 * So: drive the browser over CDP, wait a real number of milliseconds, then capture. Node 24 has a
 * built-in WebSocket, so this needs no dependency.
 *
 *   node scripts/screenshot.mjs <url> <out.png> [waitMs] [width] [height] [light|dark]
 *
 * The caller owns the browser: launch Chrome with --remote-debugging-port and kill it by PID
 * afterwards. Never `pkill chrome` — that takes the operator's own browser with it.
 */
const [, , url, out, waitMsArg, widthArg, heightArg, scheme] = process.argv
if (!url || !out) {
  console.error('usage: screenshot.mjs <url|-> <out.png> [waitMs] [width] [height] [light|dark]')
  process.exit(2)
}
const waitMs = Number(waitMsArg ?? 3500)
const width = Number(widthArg ?? 1400)
const height = Number(heightArg ?? 900)
const port = Number(process.env.CDP_PORT ?? 9222)

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) { console.error('no page target on the CDP port'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id
    pending.set(msgId, { resolve, reject })
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })

await new Promise((r) => ws.addEventListener('open', r, { once: true }))
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString())
  const p = pending.get(msg.id)
  if (!p) return
  pending.delete(msg.id)
  msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
})

await send('Page.enable')
// Force the theme rather than hoping: the render follows the OS, and a silent flip looks like a
// defect. Emulation is the only reliable way to ask for one.
if (scheme === 'light' || scheme === 'dark') {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }],
  })
}
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
// `-` means "capture whatever is already loaded, do not navigate". That mode exists because the
// interesting states here are TRANSIENT: a registry check is in flight for ~200ms, and a
// re-navigation costs ~1s during which the SPA has not even mounted the pill. Sampling a live page
// is the only way to catch it.
if (url !== '-') {
  await send('Page.navigate', { url })
} else {
  await send('Page.enable')
}
await new Promise((r) => setTimeout(r, waitMs))

const shot = await send('Page.captureScreenshot', { format: 'png' })
const { writeFileSync } = await import('node:fs')
writeFileSync(out, Buffer.from(shot.data, 'base64'))
console.log(`wrote ${out} (${width}x${height}, waited ${waitMs}ms${scheme ? ', ' + scheme : ''})`)
ws.close()
process.exit(0)
