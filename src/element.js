// <dotrino-dictation>: un botón de micrófono que devuelve texto.
//
// El componente no decide adónde va la voz: se lo dice la app con `engine`.
//   engine="local"     Whisper en el aparato (el modelo se baja una vez; nada sale)
//   engine="provider"  la función `.transcriber(blob, { language })` que pasa la app — en
//                      Dotrino, `transcribe` de @dotrino/ai con la llave del usuario
// Sin `engine` el botón sale deshabilitado: dictar es algo que el usuario enciende.
//
// Nunca la Web Speech API del navegador: manda el audio a Google o a Apple sin que la app
// pueda decir que no.

import { startRecording } from './audio.js'
import { isLocalModelReady, loadLocalModel, transcribeLocal, LOCAL_MODEL } from './local.js'
import { codeError } from './errors.js'
import { TEXT } from './i18n.js'

const MIN_MS = 600
const DEFAULT_MAX_SECONDS = 60

const MIC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z"/></svg>'
const STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'
const DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v9.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V4Zm-6 15h14v2H5v-2Z"/></svg>'

const STYLE = `
:host { display: inline-flex; align-items: center; gap: .5rem; font-family: var(--dt-font, inherit); }
button {
  inline-size: var(--dotrino-dictation-size, 2.5rem); block-size: var(--dotrino-dictation-size, 2.5rem);
  border-radius: 50%; border: 1px solid var(--dt-line, #c7d2da); cursor: pointer; padding: 0;
  display: grid; place-items: center; position: relative;
  background: var(--dt-surface, #fff); color: var(--dt-accent, #00658c);
  -webkit-tap-highlight-color: transparent;
}
button:hover:not(:disabled) { background: var(--dt-accent-tint, #e6f2f7); }
button:focus-visible { outline: 2px solid var(--dt-accent, #00658c); outline-offset: 2px; }
button:disabled { opacity: .45; cursor: not-allowed; }
svg { inline-size: 55%; block-size: 55%; fill: currentColor; }
:host([state="recording"]) button { background: var(--dt-error, #b3261e); border-color: transparent; color: #fff; animation: pulse 1.2s ease-in-out infinite; }
:host([state="transcribing"]) button, :host([state="loading"]) button { color: var(--dt-text-dim, #5b6770); }
.ring { position: absolute; inset: -3px; border-radius: 50%; pointer-events: none;
  background: conic-gradient(var(--dt-accent, #00658c) calc(var(--p, 0) * 1%), transparent 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0);
          mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0); }
:host([state="transcribing"]) .ring { background: conic-gradient(var(--dt-accent, #00658c) 25%, transparent 0); animation: spin .9s linear infinite; }
.status { font-size: .85rem; color: var(--dt-text-dim, #5b6770); }
.status:empty { display: none; }
:host([error]) .status { color: var(--dt-error, #b3261e); }
@keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--dt-error, #b3261e) 25%, transparent); } }
@keyframes spin { to { transform: rotate(1turn); } }
@media (prefers-reduced-motion: reduce) { button, .ring { animation: none !important; } }
`

export class DotrinoDictation extends HTMLElement {
  static get observedAttributes () { return ['engine', 'lang', 'disabled'] }

  constructor () {
    super()
    this.transcriber = null
    this._state = 'idle'           // idle | loading | recording | transcribing
    this._localReady = false
    this._rec = null
    this._timer = null
    this._errTimer = null
    this._progress = 0
    this._lastStatus = ''
    const root = this.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${STYLE}</style><button part="button" type="button" data-testid="dictation-button"><span class="ring"></span><span class="icon"></span></button><span class="status" part="status" role="status" aria-live="polite" data-testid="dictation-status"></span>`
    this._btn = root.querySelector('button')
    this._icon = root.querySelector('.icon')
    this._ring = root.querySelector('.ring')
    this._status = root.querySelector('.status')
    this._btn.addEventListener('click', () => this._press())
  }

  connectedCallback () {
    this._checkLocal()
    this._render()
  }

  disconnectedCallback () {
    this.cancel()
  }

  attributeChangedCallback (name) {
    if (name === 'engine') {
      this.cancel()
      this._checkLocal()
    }
    this._render()
  }

  get engine () { return this.getAttribute('engine') || '' }
  // Los frameworks (Vue) lo pasan como propiedad: se refleja en el atributo.
  set engine (v) { if (v) this.setAttribute('engine', v); else this.removeAttribute('engine') }
  get state () { return this._state }

  /** Suelta el micrófono y vuelve al reposo sin devolver texto. */
  cancel () {
    clearInterval(this._timer)
    this._timer = null
    this._rec?.cancel()
    this._rec = null
    if (this._state === 'recording') this._set('idle')
  }

  async _checkLocal () {
    if (this.engine !== 'local') return
    try {
      this._localReady = await isLocalModelReady()
    } catch (e) {
      console.error('[dictation] cache check:', e)
      this._localReady = false
    }
    this._render()
  }

  _t () {
    const lang = (this.getAttribute('lang') || document.documentElement.lang || 'es').slice(0, 2)
    return TEXT[lang] || TEXT.en
  }

  _language () {
    return (this.getAttribute('language') || this.getAttribute('lang') || document.documentElement.lang || 'es').slice(0, 2)
  }

  _set (state) {
    this._state = state
    this.setAttribute('state', state)
    this.dispatchEvent(new CustomEvent('dotrino-dictation-state', { detail: { state }, bubbles: true, composed: true }))
    this._render()
  }

  _render () {
    const t = this._t()
    const off = !['local', 'provider'].includes(this.engine) || this.hasAttribute('disabled')
    const needsModel = this.engine === 'local' && !this._localReady && this._state === 'idle'
    const busy = this._state === 'loading' || this._state === 'transcribing'
    this._btn.disabled = off || busy
    this._icon.innerHTML = this._state === 'recording' ? STOP : needsModel ? DOWN : MIC
    const label = off ? t.off
      : this._state === 'recording' ? t.stop
        : this._state === 'loading' ? t.downloading
          : this._state === 'transcribing' ? t.transcribing
            : needsModel ? `${t.download} (~${LOCAL_MODEL.sizeMB} MB)`
              : t.start
    this._btn.setAttribute('aria-label', label)
    this._btn.title = label
    this._ring.style.setProperty('--p', this._state === 'loading' ? this._progress : 0)
    if (!this.hasAttribute('error')) {
      this._status.textContent = this._state === 'loading' ? `${t.downloading} ${this._progress}%`
        : this._state === 'transcribing' ? t.transcribing
          : this._state === 'recording' ? `${t.listening} ${this._elapsed()}`
            : this._status.dataset.note || ''
    }
    this._announce()
  }

  /** Avisa cuando cambia el texto de estado, para la app que lo quiera enseñar en otro sitio. */
  _announce () {
    const text = this._status.textContent
    if (text === this._lastStatus) return
    this._lastStatus = text
    this.dispatchEvent(new CustomEvent('dotrino-dictation-status', { detail: { text, error: this.getAttribute('error') || null }, bubbles: true, composed: true }))
  }

  _elapsed () {
    const s = this._rec ? Math.floor((Date.now() - this._rec.startedAt) / 1000) : 0
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  _note (text) {
    this._status.dataset.note = text
    this._render()
  }

  _fail (e) {
    const code = e?.code || 'other'
    if (!e?.code) console.error('[dictation]', e)
    const t = this._t()
    this.dispatchEvent(new CustomEvent('dotrino-dictation-error', { detail: { code, message: String(e?.message || e) }, bubbles: true, composed: true }))
    this.setAttribute('error', code)
    this._status.textContent = t.errors[code] || t.errors.other
    this._announce()
    clearTimeout(this._errTimer)
    this._errTimer = setTimeout(() => { this.removeAttribute('error'); this._render() }, 5000)
    this._set('idle')
  }

  async _press () {
    this.removeAttribute('error')
    this._note('')
    if (this._state === 'recording') return this._finish()
    if (this._state !== 'idle') return
    if (this.engine === 'local' && !this._localReady) return this._download()
    if (this.engine === 'provider' && typeof this.transcriber !== 'function') {
      return this._fail(codeError('no-transcriber', 'engine="provider" needs a .transcriber function'))
    }
    try {
      this._rec = await startRecording()
    } catch (e) {
      return this._fail(e)
    }
    this._set('recording')
    const max = Number(this.getAttribute('max-seconds')) || DEFAULT_MAX_SECONDS
    this._timer = setInterval(() => {
      if (Date.now() - this._rec.startedAt >= max * 1000) this._finish()
      else this._render()
    }, 250)
  }

  async _download () {
    this._progress = 0
    this._set('loading')
    try {
      await loadLocalModel({
        onProgress: ({ loaded, total }) => {
          this._progress = Math.min(99, Math.floor((loaded / total) * 100))
          this._render()
        },
      })
      this._localReady = true
      this._set('idle')
      this._note(this._t().ready)
      this.dispatchEvent(new CustomEvent('dotrino-dictation-ready', { bubbles: true, composed: true }))
    } catch (e) {
      this._fail(e)
    }
  }

  async _finish () {
    clearInterval(this._timer)
    this._timer = null
    const rec = this._rec
    this._rec = null
    if (!rec) return
    const ms = Date.now() - rec.startedAt
    this._set('transcribing')
    try {
      const blob = await rec.stop()
      if (ms < MIN_MS) throw codeError('too-short', `recording too short (${ms} ms)`)
      const language = this._language()
      const text = String(this.engine === 'local'
        ? await transcribeLocal(blob, { language })
        : await this.transcriber(blob, { language }) || '').trim()
      if (!text) throw codeError('empty', 'the transcription came back empty')
      this._set('idle')
      this.dispatchEvent(new CustomEvent('dotrino-dictation-text', { detail: { text, engine: this.engine }, bubbles: true, composed: true }))
    } catch (e) {
      this._fail(e)
    }
  }
}

if (!customElements.get('dotrino-dictation')) customElements.define('dotrino-dictation', DotrinoDictation)
