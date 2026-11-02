import { describe, expect, test } from 'bun:test'
import { networkErrorReason, responseErrorReason, trackedFields } from '../src/form/tracking.ts'

const noneInternal = () => false

describe('trackedFields', () => {
	test('keeps the field names and drops what was typed', () => {
		const fields = trackedFields([['name', 'Jana Nováková'], ['email', 'jana@example.com'], ['message', 'Dobrý den']], noneInternal)
		expect(fields).toEqual({ name: '', email: '', message: '' })
	})

	test('an uploaded file contributes its field name, not the file name', () => {
		const file = new File(['%PDF'], 'zdravotni-zprava-jana.pdf')
		const fields = trackedFields([['attachment', file]], noneInternal)
		expect(fields).toEqual({ attachment: '' })
		expect(JSON.stringify(fields)).not.toContain('jana')
	})

	test('a field submitted more than once is listed once', () => {
		const fields = trackedFields([['topics', 'a'], ['topics', 'b']], noneInternal)
		expect(fields).toEqual({ topics: '' })
	})

	test('leaves out the fields the predicate marks internal', () => {
		const fields = trackedFields([['email', 'x'], ['token_ab12', 'form:1:abc'], ['contact_required', '']], name => name !== 'email')
		expect(fields).toEqual({ email: '' })
	})
})

describe('error reasons', () => {
	test('a refused response is recorded by its status', () => {
		expect(responseErrorReason(413)).toBe('http_413')
	})

	test('a failed request is recorded as a network error', () => {
		expect(networkErrorReason).toBe('network_error')
	})
})
