// @dotrino/dictation — dictar en vez de escribir, con la voz en el aparato o en el proveedor
// que el usuario eligió. Importarlo registra <dotrino-dictation>.

export { DotrinoDictation } from './element.js'
export { LOCAL_MODEL, isLocalModelReady, loadLocalModel, transcribeLocal } from './local.js'
export { startRecording, decodeTo16k } from './audio.js'
export { codeError } from './errors.js'
