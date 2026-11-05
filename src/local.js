// El motor local: habla con el worker (worker.js) y dice si el modelo ya está en el aparato.

import { codeError } from './errors.js'
import { decodeTo16k } from './audio.js'

/** El modelo: Whisper base multilingüe, cuantizado a 8 bits (~77 MB, se baja una vez). */
/** @type {Readonly<{ id: string, sizeMB: number, source: string }>} */
export const LOCAL_MODEL = Object.freeze({
  id: 'onnx-community/whisper-base',
  sizeMB: 77,
  source: 'huggingface.co',
})

// Lo que guarda la librería en la Cache API del navegador (`env.cacheKey`).
const CACHE_NAME = 'transformers-cache'

/** @typedef {(p: { loaded: number, total: number }) => void} ProgressFn */

/** @type {Worker | null} */
let worker = null
let seq = 0
/** @type {Map<number, { resolve: (data: any) => void, reject: (e: Error) => void, onProgress?: ProgressFn }>} */
const pending = new Map()   // id → { resolve, reject, onProgress }

/** @returns {Worker} */
function getWorker () {
  if (worker) return worker
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id)
    if (!job) return
    if (data.op === 'progress') {
      job.onProgress?.({ loaded: data.loaded, total: data.total })
      return
    }
    pending.delete(data.id)
    if (data.op === 'error') job.reject(codeError(data.code, data.message))
    else job.resolve(data)
  }
  worker.onerror = (e) => {
    const err = codeError('worker-failed', `the dictation worker failed: ${e.message || 'unknown error'}`)
    for (const job of pending.values()) job.reject(err)
    pending.clear()
    worker = null
  }
  return worker
}

/**
 * @param {Record<string, unknown>} msg
 * @param {ProgressFn} [onProgress]
 * @param {Transferable[]} [transfer]
 * @returns {Promise<any>} la respuesta del worker (`{ op, id, ... }`)
 */
function call (msg, onProgress, transfer = []) {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    getWorker().postMessage({ ...msg, id, model: LOCAL_MODEL.id }, transfer)
  })
}

/**
 * ¿Está el modelo en este aparato? Mira la caché del navegador: el codificador y el
 * decodificador tienen que estar los dos.
 * @returns {Promise<boolean>}
 */
export async function isLocalModelReady () {
  if (typeof caches === 'undefined') return false
  const cache = await caches.open(CACHE_NAME)
  const urls = (await cache.keys()).map((r) => r.url)
  /** @param {string} part */
  const has = (part) => urls.some((u) => u.includes(LOCAL_MODEL.id) && u.includes(part))
  return has('encoder_model_quantized.onnx') && has('decoder_model_merged_quantized.onnx')
}

/**
 * Baja el modelo (si no está) y lo deja cargado. `onProgress({ loaded, total })` en bytes.
 * Lanza `model-load-failed` si no se pudo (sin red, sin espacio).
 * @param {{ onProgress?: ProgressFn }} [opts]
 * @returns {Promise<void>}
 */
export async function loadLocalModel ({ onProgress } = {}) {
  await call({ op: 'load' }, onProgress)
}

/**
 * Audio → texto, todo en el aparato.
 * @param {Blob} audio  lo que grabó el micrófono (webm/opus, mp4…)
 * @param {{ language?: string, onProgress?: ProgressFn }} [opts]  `language`: 'es', 'en'…
 * @returns {Promise<string>}
 */
export async function transcribeLocal (audio, { language, onProgress } = {}) {
  const pcm = await decodeTo16k(audio)
  const { text } = await call({ op: 'transcribe', audio: pcm, language }, onProgress, [pcm.buffer])
  return text
}
