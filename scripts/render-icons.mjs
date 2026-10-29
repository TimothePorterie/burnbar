// Renders assets/app-icon.svg to assets/icon.png (1024x1024, transparent outside the squircle).
// No npm dependency: point PLAYWRIGHT_CORE at an existing playwright-core install.
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/render-icons.mjs
// Optional CHROMIUM: a Chromium / chrome-headless-shell executable, when the browser
// installed for that playwright-core revision is missing.

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.env.PLAYWRIGHT_CORE) {
  console.error('Set PLAYWRIGHT_CORE to a playwright-core directory')
  process.exit(1)
}

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE)
const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const svg = await readFile(join(assets, 'app-icon.svg'), 'utf8')

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM })
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await page.setContent(
  `<style>html,body{margin:0;background:transparent}img{display:block}</style>
  <img width="1024" height="1024" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`
)
await page.locator('img').screenshot({ path: join(assets, 'icon.png'), omitBackground: true })
await browser.close()
console.log('assets/icon.png')
