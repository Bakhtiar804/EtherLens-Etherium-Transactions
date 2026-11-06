import test from 'node:test'
import assert from 'node:assert/strict'
import { compact } from '../src/lib/data.js'
test('compact amounts never leave a dangling decimal point',()=>{assert.equal(compact('0.0'),'0');assert.equal(compact('1.00000'),'1');assert.equal(compact('1.23000'),'1.23')})
