/**
 * Un error con `code`: quien lo recibe decide por el código, no por la frase.
 * `extra` añade campos (p. ej. `status`); `extra.cause` va como causa del Error.
 */
/** @typedef {Error & { code: string }} CodeError */

/**
 * @param {string} code
 * @param {string} message
 * @param {{ cause?: unknown, [field: string]: unknown }} [extra]
 * @returns {CodeError}
 */
export function codeError (code, message, extra) {
  const { cause, ...rest } = extra || {}
  const e = /** @type {CodeError} */ (new Error(message, cause !== undefined ? { cause } : undefined))
  e.code = code
  return Object.assign(e, rest)
}
