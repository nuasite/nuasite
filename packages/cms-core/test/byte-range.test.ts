import { describe, expect, test } from 'bun:test'
import { resolveByteRange } from '../src/byte-range'

describe('resolveByteRange', () => {
	test('a bounded, open-ended or suffix range resolves to an inclusive span', () => {
		expect(resolveByteRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
		expect(resolveByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
		expect(resolveByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
	})

	test('an end or suffix past the resource is clamped to it', () => {
		expect(resolveByteRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 })
		expect(resolveByteRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
	})

	test('a range starting past the end, or an empty suffix, is unsatisfiable', () => {
		expect(resolveByteRange('bytes=100-', 100)).toBe('unsatisfiable')
		expect(resolveByteRange('bytes=-0', 100)).toBe('unsatisfiable')
		expect(resolveByteRange('bytes=0-', 0)).toBe('unsatisfiable')
	})

	test('no header, a malformed one or several ranges serve the whole resource', () => {
		expect(resolveByteRange(null, 100)).toBeNull()
		expect(resolveByteRange('bytes=-', 100)).toBeNull()
		expect(resolveByteRange('bytes=9-0', 100)).toBeNull()
		expect(resolveByteRange('items=0-9', 100)).toBeNull()
		expect(resolveByteRange('bytes=0-9,20-29', 100)).toBeNull()
	})
})
