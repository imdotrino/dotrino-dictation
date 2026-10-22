import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TEXT } from '../src/i18n.js'
import { codeError } from '../src/errors.js'

function keys (o, prefix = '') {
  return Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]).sort()
}

test('es and en say the same things', () => {
  assert.deepEqual(keys(TEXT.es), keys(TEXT.en))
})

test('no voseo in the Spanish copy', () => {
  const all = JSON.stringify(TEXT.es)
  assert.doesNotMatch(all, /\b(pulsá|mantené|probá|podés|querés|tenés|hablá)\b/i)
})

test('codeError carries the code', () => {
  const e = codeError('mic-denied', 'x')
  assert.equal(e.code, 'mic-denied')
})
