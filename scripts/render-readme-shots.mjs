// Renders assets/readme/popup.png: the real popup (light and dark) with sample data from every provider,
// set on a warm backdrop under a menu bar. Linux + xvfb (fake HOME, Keychain and CLIs); run `npm run build` first.
// No npm dependency: point PLAYWRIGHT_CORE at an existing playwright-core install.
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core xvfb-run -a node scripts/render-readme-shots.mjs
// Optional CHROMIUM: a Chromium executable for the composition, when the playwright-core browser is missing.
// The popup font is forced to Inter for the capture only (install it, e.g. in ~/.local/share/fonts).

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.env.PLAYWRIGHT_CORE) {
  console.error('Set PLAYWRIGHT_CORE to a playwright-core directory')
  process.exit(1)
}

const { _electron: electron, chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'assets', 'readme')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const tmp = mkdtempSync(join(tmpdir(), 'burnbar-shots-'))
const home = join(tmp, 'home')
const bin = join(tmp, 'bin')
mkdirSync(bin, { recursive: true })
const fake = (name, body) => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
  chmodSync(join(bin, name), 0o755)
}
const credentials = JSON.stringify({
  claudeAiOauth: { accessToken: 'sample-access-token', expiresAt: Date.now() + 3600e3, subscriptionType: 'max' },
  emailAddress: 'alex@example.com',
  displayName: 'Alex Martin'
})
fake('security', `case "$*" in *-w*) echo '${credentials}';; esac`)
const rateLimits = now => JSON.stringify({
  id: 2,
  result: {
    rateLimits: {
      primary: { usedPercent: 27, windowDurationMins: 300, resetsAt: now + 11400 },
      secondary: { usedPercent: 18, windowDurationMins: 10080, resetsAt: now + 439200 },
      planType: 'plus'
    },
    rateLimitResetCredits: { availableCount: 1 }
  }
})
fake('codex', `read a; echo '{"id":1,"result":{}}'; read b; read c
echo '${rateLimits(Math.floor(Date.now() / 1000))}'
exec sleep 30`)
// Three Grok sessions: two today, one three days ago
fake('grok', `case "$2" in *0) day=3;; *) day=0;; esac
echo "{\\"updatedAt\\":\\"$(date -u -d "-$day days" +%Y-%m-%dT%H:%M:%SZ)\\",\\"session\\":{\\"totalTokens\\":1418220,\\"costUsdTicks\\":21436000000}}"`)
fake('opencode', `case "$*" in
  *"--days 0"*) echo '{"tokens":{"input":402113,"output":61208,"reasoning":12044,"cache":{"read":288310,"write":0}},"cost":0.86}';;
  *) echo '{"tokens":{"input":2104552,"output":301876,"reasoning":88410,"cache":{"read":1612003,"write":40210}},"cost":6.42}';;
esac`)
for (const id of ['0', '1', '2']) {
  const session = join(home, '.grok/sessions/%2Fwork', `01a1871c-5b6d-7b21-a6e6-23b5c5e3586${id}`)
  mkdirSync(session, { recursive: true })
  writeFileSync(join(session, 'usage.json'), '{}')
}

const app = await electron.launch({
  executablePath: join(root, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--force-device-scale-factor=2', root],
  env: {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: process.env.XDG_DATA_HOME ?? join(process.env.HOME, '.local/share'),
    PATH: `${bin}:/usr/bin:/bin`,
    SHELL: '/bin/sh',
    ELECTRON_RENDERER_URL: ''
  }
})
await app.evaluate(({ Tray }) => {
  const at = hours => new Date(Date.now() + hours * 3600e3).toISOString()
  const usage = {
    five_hour: { utilization: 72, resets_at: at(0.95) },
    seven_day: { utilization: 41, resets_at: at(62) },
    seven_day_opus: { utilization: 23, resets_at: at(62) },
    seven_day_sonnet: { utilization: 52, resets_at: at(62) }
  }
  globalThis.fetch = async url => {
    if (!String(url).includes('/api/oauth/usage')) throw new TypeError('fetch failed')
    return new Response(JSON.stringify(usage), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  for (const method of ['setTitle', 'setImage']) {
    const original = Tray.prototype[method]
    Tray.prototype[method] = function (...args) {
      globalThis.tray = this
      globalThis[method] = args[0]
      return original.apply(this, args)
    }
  }
})
// Detection, then the first reads (the schedulers start after 2 s)
await sleep(8000)
const tray = await app.evaluate(() => ({ title: globalThis.setTitle, icon: globalThis.setImage.toPNG({ scaleFactor: 2 }).toString('base64') }))
await app.evaluate(() => globalThis.tray.emit('click', {}, globalThis.tray.getBounds()))
let popup
while (!(popup = app.windows().find(window => window.url().includes('popup')))) await sleep(250)
await popup.waitForLoadState('domcontentloaded')
await sleep(1500)
// Capture only: Inter for the missing system font, an opaque fill for the vibrancy material, no height cap
await popup.addStyleTag({ content: `
  :root { --font: 'Inter Variable', Inter, sans-serif; }
  html, body { background: #F3F1EC; }
  @media (prefers-color-scheme: dark) { html, body { background: #262422; } }
  .popup { max-height: none !important; overflow: visible !important; }
` })
await app.evaluate(({ BrowserWindow }) => {
  BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('popup')).setSize(320, 1000)
})
const shots = {}
for (const scheme of ['light', 'dark']) {
  await popup.emulateMedia({ colorScheme: scheme })
  await sleep(400)
  shots[scheme] = (await popup.locator('.popup').screenshot()).toString('base64')
}
await app.close()
rmSync(tmp, { recursive: true, force: true })

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM })
const page = await browser.newPage({ viewport: { width: 880, height: 900 }, deviceScaleFactor: 1.5 })
await page.setContent(`<!doctype html>
<style>
  html, body { margin: 0; background: transparent; }
  .stage {
    position: relative; width: 880px; overflow: hidden; border-radius: 20px;
    background-size: 100% 100%;
    font: 500 13px/1 'Inter Variable', Inter, sans-serif;
  }
  .menubar { height: 30px; background: rgba(40, 18, 10, .25); color: #fff; }
  .item { position: absolute; top: 4px; height: 22px; display: flex; align-items: center; gap: 5px; padding: 0 8px; border-radius: 5px; }
  .item.active { background: rgba(255, 255, 255, .22); font-variant-numeric: tabular-nums; }
  .item img { width: 18px; height: 18px; filter: invert(1); }
  .clock { right: 10px; }
  .popup {
    position: absolute; width: 320px; border-radius: 14px; overflow: hidden;
    box-shadow: 0 0 0 .5px rgba(0, 0, 0, .3), 0 24px 60px rgba(70, 22, 6, .38), 0 6px 16px rgba(70, 22, 6, .2);
  }
  .popup img { display: block; width: 320px; }
  .light { right: 92px; top: 40px; }
  .dark { right: 452px; top: 72px; }
</style>
<div class="stage">
  <div class="menubar">
    <span class="item active"><img src="data:image/png;base64,${tray.icon}">${tray.title}</span>
    <span class="item clock">Tue 9:41</span>
  </div>
  <div class="popup dark"><img src="data:image/png;base64,${shots.dark}"></div>
  <div class="popup light"><img src="data:image/png;base64,${shots.light}"></div>
</div>`)
await page.evaluate(async () => {
  await Promise.all([...document.images].map(image => image.decode()))
  const stage = document.querySelector('.stage')
  const popups = [...document.querySelectorAll('.popup')]
  stage.style.height = `${Math.max(...popups.map(popup => popup.offsetTop + popup.offsetHeight)) + 48}px`
  // The popup hangs under its menu bar item
  const light = document.querySelector('.light')
  const item = document.querySelector('.item.active')
  item.style.left = `${light.offsetLeft + (light.offsetWidth - item.offsetWidth) / 2}px`
  // Drawn small and stretched: a smooth backdrop without dithering noise, so the PNG stays light
  const canvas = Object.assign(document.createElement('canvas'), { width: 88, height: Math.round(stage.offsetHeight / 10) })
  const context = canvas.getContext('2d')
  const base = context.createLinearGradient(0, 0, canvas.width, canvas.height)
  base.addColorStop(0, '#F7B57E')
  base.addColorStop(0.5, '#E07A4A')
  base.addColorStop(1, '#A9411F')
  context.fillStyle = base
  context.fillRect(0, 0, canvas.width, canvas.height)
  const glow = context.createRadialGradient(70, 0, 0, 70, 0, 60)
  glow.addColorStop(0, 'rgba(255, 222, 172, .85)')
  glow.addColorStop(1, 'rgba(255, 222, 172, 0)')
  context.fillStyle = glow
  context.fillRect(0, 0, canvas.width, canvas.height)
  stage.style.backgroundImage = `url(${canvas.toDataURL()})`
})
mkdirSync(out, { recursive: true })
await page.locator('.stage').screenshot({ path: join(out, 'popup.png'), omitBackground: true })
await browser.close()
console.log('assets/readme/popup.png')
