import { describe, expect, test } from 'bun:test'
import { responseErrorReason, trackedFields } from '../src/form/tracking.ts'

describe('trackedFields', () => {
	test('keeps the field names and drops what was typed', () => {
		const fields = trackedFields([['name', 'Jana Nováková'], ['email', 'jana@example.com'], ['message', 'Dobrý den']], new Set())
		expect(fields).toEqual({ name: '', email: '', message: '' })
	})

	test('an uploaded file contributes its field name, not the file name', () => {
		const file = new File(['%PDF'], 'zdravotni-zprava-jana.pdf')
		const fields = trackedFields([['attachment', file]], new Set())
		expect(fields).toEqual({ attachment: '' })
		expect(JSON.stringify(fields)).not.toContain('jana')
	})

	test('a field submitted more than once is listed once', () => {
		const fields = trackedFields([['topics', 'a'], ['topics', 'b']], new Set())
		expect(fields).toEqual({ topics: '' })
	})

	test('leaves out the internal fields', () => {
		const fields = trackedFields([['email', 'x'], ['token_ab12', 'form:1:abc']], new Set(['token_ab12']))
		expect(fields).toEqual({ email: '' })
	})
})

describe('responseErrorReason', () => {
	test('a refused response is recorded by its status, not by the server text', () => {
		expect(responseErrorReason({ ok: false, status: 413 })).toBe('http_413')
	})

	test('a 2xx response without success does not read as a successful status', () => {
		expect(responseErrorReason({ ok: true, status: 200 })).toBe('not_accepted')
	})
})
