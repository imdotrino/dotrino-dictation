// Whisper en el aparato, dentro de un worker para que la pantalla no se congele mientras
// piensa. El audio entra ya decodificado (Float32Array, 16 kHz, mono) y sale texto: aquí no
// hay red salvo la descarga del modelo, que se hace una vez y queda en la caché del navegador.
//
// El runtime de ONNX (un .wasm de ~14 MB) lo sirve la propia app: por defecto la librería lo
// baja de un CDN, y eso es código de terceros cargado en tiempo de ejecución.

import { pipeline, env } from '@huggingface/transformers'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

env.allowLocalModels = false
env.useBrowserCache = true
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL(ortMjs, self.location.href).href,
  wasm: new URL(ortWasm, self.location.href).href,
}
// Sin aislamiento entre orígenes (GitHub Pages no deja poner las cabeceras) no hay hilos.
env.backends.onnx.wasm.numThreads = 1

let asr = null
let loading = null

function load (model, id) {
  if (asr) return Promise.resolve(asr)
  if (loading) return loading
  const files = new Map()
  loading = pipeline('automatic-speech-recognition', model, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p) => {
      if (p.status !== 'progress' || !p.total) return
      files.set(p.file, { loaded: p.loaded, total: p.total })
      let loaded = 0
      let total = 0
      for (const f of files.values()) { loaded += f.loaded; total += f.total }
      self.postMessage({ op: 'progress', id, loaded, total })
    },
  }).then((p) => {
    asr = p
    return p
  }, (e) => {
    loading = null
    throw e
  })
  return loading
}

self.onmessage = async ({ data }) => {
  const { op, id } = data
  try {
    if (op === 'load') {
      await load(data.model, id)
      self.postMessage({ op: 'ready', id })
    } else if (op === 'transcribe') {
      const p = await load(data.model, id)
      const out = await p(data.audio, {
        language: data.language || null,
        task: 'transcribe',
        chunk_length_s: 30,
        stride_length_s: 5,
      })
      self.postMessage({ op: 'result', id, text: String(out?.text || '').trim() })
    } else {
      self.postMessage({ op: 'error', id, code: 'unknown-op', message: `unknown worker op: ${op}` })
    }
  } catch (e) {
    console.error('[dictation] worker:', e)
    const code = op === 'load' || !asr ? 'model-load-failed' : 'transcribe-failed'
    self.postMessage({ op: 'error', id, code, message: String(e?.message || e) })
  }
}
