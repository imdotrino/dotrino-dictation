// El dictado en un Chromium de verdad, con un micrófono falso que «dice» test/fixtures/es.wav
// («Almuerzo, cuatro dólares con cincuenta»). El motor local baja el modelo de verdad la
// primera vez (~77 MB desde huggingface.co) y transcribe en el aparato. El proveedor es una
// función de la demo: comprueba que le llega el audio grabado.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ORIGIN = 'https://dictation.test'
const DIST = fileURLToPath(new URL('../../dist-demo/', import.meta.url))
const WAV = fileURLToPath(new URL('../fixtures/es.wav', import.meta.url))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' }

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
})
after(() => browser.close())

async function open () {
  const ctx = await browser.newContext({ permissions: ['microphone'] })
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    let path = new URL(route.request().url()).pathname
    if (path === '/') path = '/index.html'
    try {
      const body = await readFile(join(DIST, path))
      return route.fulfill({ status: 200, contentType: TYPES[extname(path)] || 'application/octet-stream', body })
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      return route.fulfill({ status: 404, body: 'not found' })
    }
  })
  const page = await ctx.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  // Lo que pide la página fuera de su origen: solo el modelo, y solo de huggingface.
  const outside = new Set()
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.origin !== ORIGIN && u.protocol.startsWith('http')) outside.add(u.hostname)
  })
  ctx.on('serviceworker', () => {})
  await page.goto(ORIGIN + '/')
  return { ctx, page, problems, outside }
}

async function speak (page, id, ms = 4500) {
  const btn = page.locator(`#${id}`).getByTestId('dictation-button')
  await btn.click()
  await page.locator(`#${id}[state="recording"]`).waitFor()
  await page.waitForTimeout(ms)
  await btn.click()
}

test('off without engine; provider gets the recorded audio', { timeout: 60_000 }, async () => {
  const { ctx, page, problems } = await open()
  assert.equal(await page.locator('#off').getByTestId('dictation-button').isDisabled(), true)

  await speak(page, 'provider', 1500)
  await page.getByTestId('out').filter({ hasText: 'provider text:' }).waitFor()
  assert.match(await page.getByTestId('out').innerText(), /provider text: provider es audio\/(webm|ogg|mp4) audio/)

  // Muy corto: se dice, no se manda.
  const btn = page.locator('#provider').getByTestId('dictation-button')
  await btn.click()
  await page.locator('#provider[state="recording"]').waitFor()
  await btn.click()
  await page.getByTestId('out').filter({ hasText: 'provider error: too-short' }).waitFor()
  assert.match(await page.locator('#provider').getByTestId('dictation-status').innerText(), /Muy corto/)

  assert.deepEqual(problems, [])
  await ctx.close()
})

test('local Whisper: download once, then transcribe on the device', { timeout: 600_000 }, async () => {
  const { ctx, page, problems, outside } = await open()
  const btn = page.locator('#local').getByTestId('dictation-button')
  assert.match(await btn.getAttribute('aria-label'), /Descargar el modelo de voz/)

  await btn.click()
  await page.getByTestId('out').filter({ hasText: /local (ready|error)/ }).waitFor({ timeout: 540_000 })
  assert.match(await page.getByTestId('out').innerText(), /local ready/)
  assert.match(await btn.getAttribute('aria-label'), /^Dictar$/)

  const t0 = Date.now()
  await speak(page, 'local')
  await page.getByTestId('out').filter({ hasText: /local (text|error):/ }).waitFor({ timeout: 120_000 })
  const out = await page.getByTestId('out').innerText()
  console.log(`# ${out.trim().split('\n').at(-1)} (${Date.now() - t0} ms incl. 4.5 s of speech)`)
  // Whisper base no siempre acierta cada palabra (con esta voz oye «al muerto»): se comprueba
  // que lo dicho llegó como texto y que el importe está.
  assert.match(out, /local text: .*d[oó]lares/i)
  assert.match(out, /local text: .*(4|cuatro).*(50|cincuenta)/i)

  // Recargar: el modelo ya está en el aparato, el botón ya no pide descargar.
  await page.reload()
  await page.locator('#local').getByTestId('dictation-button').and(page.locator('[aria-label="Dictar"]')).waitFor({ timeout: 20_000 })

  assert.deepEqual([...outside].filter((h) => !/(^|\.)huggingface\.co$|(^|\.)hf\.co$/.test(h)), [], 'only the model host is contacted')
  assert.deepEqual(problems, [])
  await ctx.close()
})
