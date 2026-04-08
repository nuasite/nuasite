import { describe, expect, test } from 'bun:test'
import { generateNoteId, generateReplyId } from '../src/storage/id-gen'

describe('generateNoteId', () => {
	test('starts with n- prefix', () => {
		expect(generateNoteId()).toMatch(/^n-/)
	})

	test('contains ISO date segment', () => {
		const fixed = new Date('2026-03-15T12:00:00Z')
		const id = generateNoteId(fixed)
		expect(id).toMatch(/^n-2026-03-15-[a-z0-9]{6}$/)
	})

	test('generates unique IDs', () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateNoteId()))
		expect(ids.size).toBe(100)
	})
})

describe('generateReplyId', () => {
	test('starts with r- prefix', () => {
		expect(generateReplyId()).toMatch(/^r-/)
	})

	test('contains ISO date segment', () => {
		const fixed = new Date('2026-01-01T00:00:00Z')
		const id = generateReplyId(fixed)
		expect(id).toMatch(/^r-2026-01-01-[a-z0-9]{6}$/)
	})
})
