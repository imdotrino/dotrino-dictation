# @dotrino/dictation

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Dotrino es un ecosistema de aplicaciones centradas en la privacidad de los datos: tu información es tuya, y las decisiones sobre ella también — qué compartes, con quién, cuándo y por qué. Sin anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

Dictar en vez de escribir. `<dotrino-dictation>` es un botón de micrófono que devuelve
texto, y la app le dice adónde va la voz:

| `engine` | Dónde se convierte la voz en texto | Qué sale del aparato |
|---|---|---|
| `local` | **Whisper en el aparato** (`onnx-community/whisper-base`, 8 bits, ~77 MB que se bajan una vez de huggingface.co y quedan en la caché del navegador), en un worker | nada |
| `provider` | la función `.transcriber(blob, { language })` que pasa la app; en Dotrino, `transcribe` de [`@dotrino/ai`](https://github.com/imdotrino/dotrino-ai) con la llave del usuario | el audio, al proveedor que el usuario eligió |
| *(sin `engine`)* | — | el botón sale deshabilitado: dictar lo enciende el usuario |

**Nunca la Web Speech API del navegador**: Chrome manda el audio a Google y Safari a Apple,
sin que la app pueda decir que no.

En el wiki: [wiki.dotrino.com/desarrollo/pilares](https://wiki.dotrino.com/desarrollo/pilares/).

## Uso

```js
import '@dotrino/dictation'                       // registra <dotrino-dictation>
import { createAI } from '@dotrino/ai'

const mic = document.querySelector('dotrino-dictation')
mic.engine = 'provider'                           // o 'local'
mic.transcriber = (blob, opts) => ai.transcribe(blob, opts)
mic.addEventListener('dotrino-dictation-text', (e) => console.log(e.detail.text))
```

```html
<dotrino-dictation engine="local" lang="es"></dotrino-dictation>
```

| Atributo | |
|---|---|
| `engine` | `local` · `provider` |
| `lang` | idioma de los textos del botón (`es`/`en`; por defecto el del `<html>`) |
| `language` | idioma que se habla, para Whisper (por defecto `lang`) |
| `max-seconds` | corta solo a los N segundos (60) |
| `disabled` | |

| Evento | `detail` |
|---|---|
| `dotrino-dictation-text` | `{ text, engine }` |
| `dotrino-dictation-error` | `{ code, message }` |
| `dotrino-dictation-state` | `{ state }`: `idle` · `loading` · `recording` · `transcribing` |
| `dotrino-dictation-status` | `{ text, error }`: lo que dice el botón, para enseñarlo en otro sitio (y ocultar `::part(status)`) |
| `dotrino-dictation-ready` | el modelo local terminó de bajar |

Con `engine="local"` y el modelo sin bajar, el primer toque **descarga** (con el porcentaje
en el anillo del botón) y el siguiente graba. Partes: `::part(button)`, `::part(status)`.

Sin el componente: `isLocalModelReady()`, `loadLocalModel({ onProgress })`,
`transcribeLocal(blob, { language })`, `startRecording()`, `LOCAL_MODEL`.

## En la app (Vite)

```js
// vite.config.js
worker: { format: 'es' },     // el worker usa imports dinámicos
optimizeDeps: { exclude: ['@dotrino/dictation', '@huggingface/transformers', 'onnxruntime-web'] },  // solo dev
```

El runtime de ONNX (`.wasm`, ~14 MB) lo sirve la propia app desde sus assets: por defecto la
librería lo bajaría de un CDN, y eso sería código de terceros cargado en marcha. Sin
aislamiento entre orígenes (GitHub Pages) corre en un solo hilo. Una frase de 4 s tarda ~3 s
en un portátil.

## Errores (`code`)

`mic-unsupported` · `mic-denied` · `mic-missing` · `mic-failed` · `audio-undecodable` ·
`too-short` · `empty` · `no-transcriber` · `model-load-failed` · `transcribe-failed` ·
`worker-failed`. El botón enseña el texto; el evento lleva el código.

## Desarrollo

```bash
npm test            # unitarias (Node)
npm run dev         # demo en http://localhost:3151
npm run test:e2e    # Chromium con micrófono falso (test/fixtures/es.wav); baja el modelo de verdad
```
