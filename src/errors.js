/**
 * Un error con `code`: quien lo recibe decide por el código, no por la frase.
 * `extra` añade campos (p. ej. `status`); `extra.cause` va como causa del Error.
 */
export function codeError (code, message, extra) {
  const { cause, ...rest } = extra || {}
  const e = new Error(message, cause !== undefined ? { cause } : undefined)
  e.code = code
  return Object.assign(e, rest)
}
