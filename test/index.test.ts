import assert from 'node:assert/strict'
import { test } from 'vitest'
import { add } from '../src/index.js'

test('add', () => {
  assert.equal(add(1, 2), 3)
})
