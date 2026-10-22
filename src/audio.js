// Grabar del micrófono y dejar el audio como lo quiere Whisper. Nada sale del aparato aquí.

import { codeError } from './errors.js'

const SAMPLE_RATE = 16000

/** El formato que este navegador sabe grabar, en orden de preferencia. */
function pickMime () {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(m)) return m
  }
  return ''
}

/**
 * Empieza a grabar. Devuelve `{ stop, cancel, startedAt }`: `stop()` resuelve con el Blob,
 * `cancel()` suelta el micrófono sin devolver nada.
 * Errores: `mic-unsupported`, `mic-denied`, `mic-missing`, `mic-failed`.
 */
export async function startRecording () {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw codeError('mic-unsupported', 'this browser cannot record audio')
  }
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
  } catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') throw codeError('mic-denied', 'microphone permission denied', { cause: e })
    if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') throw codeError('mic-missing', 'no microphone found', { cause: e })
    throw codeError('mic-failed', `could not open the microphone: ${e?.message || e}`, { cause: e })
  }
  const mime = pickMime()
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks = []
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data) }
  const release = () => stream.getTracks().forEach((t) => t.stop())
  const done = new Promise((resolve, reject) => {
    rec.onstop = () => {
      release()
      resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }))
    }
    rec.onerror = (e) => {
      release()
      reject(codeError('mic-failed', `recording failed: ${e?.error?.message || 'unknown error'}`))
    }
  })
  rec.start()
  return {
    startedAt: Date.now(),
    stop () {
      if (rec.state !== 'inactive') rec.stop()
      return done
    },
    cancel () {
      rec.onstop = release
      if (rec.state !== 'inactive') rec.stop()
      else release()
    },
  }
}

/** Blob grabado → Float32Array a 16 kHz, mono (lo que pide Whisper). */
export async function decodeTo16k (blob) {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice()
    const out = new Float32Array(buf.length)
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c)
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels
    }
    return out
  } catch (e) {
    throw codeError('audio-undecodable', `the recorded audio could not be decoded: ${e?.message || e}`, { cause: e })
  } finally {
    ctx.close()
  }
}
