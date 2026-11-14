import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCsv } from './csv.js'

test('parses quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('Name,Category\n"Coffee, ceramic","Home ""Living"""'), [
    ['Name', 'Category'],
    ['Coffee, ceramic', 'Home "Living"'],
  ])
})

test('parses quoted multiline cells and CRLF rows', () => {
  assert.deepEqual(parseCsv('Name,Category\r\n"Desk lamp\nwith shade",Home'), [
    ['Name', 'Category'],
    ['Desk lamp\nwith shade', 'Home'],
  ])
})

test('strips a UTF-8 BOM and ignores blank rows', () => {
  assert.deepEqual(parseCsv('\uFEFFName,Category\n\nLamp,Home\n  \n'), [
    ['Name', 'Category'],
    ['Lamp', 'Home'],
  ])
})

test('rejects malformed or unclosed quoted fields', () => {
  assert.throws(() => parseCsv('Name,Category\n"Desk"lamp,Home'), /Tanda kutip CSV tidak valid/)
  assert.throws(() => parseCsv('Name,Category\n"Desk,Home'), /belum ditutup/)
})
