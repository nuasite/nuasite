import { describe, expect, test } from 'bun:test'
import { internalFieldNames, responseErrorReason, trackedFields } from '../src/form/tracking.ts'

const formWith = (html: string) => {
	const form = document.createElement('form')
	form.innerHTML = html
	return form
}

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

describe('internalFieldNames', () => {
	test('collects the honeypots, the token and the aria-hidden CSS honeypot', () => {
		const form = formWith(`
			<input name="email">
			<input name="contact_required">
			<input type="hidden" name="token_ab12">
			<input name="css_trap_9f8e" aria-hidden="true">
		`)
		const internal = internalFieldNames(form, ['contact_required', 'website_url_required'], 'token_ab12')
		expect([...internal].sort()).toEqual(['contact_required', 'css_trap_9f8e', 'token_ab12', 'website_url_required'])
	})

	test('a visitor field that merely starts with token_ is not internal', () => {
		const form = formWith('<input name="token_code">')
		expect(internalFieldNames(form, [], 'token_ab12').has('token_code')).toBe(false)
	})

	test('a field name with quotes or brackets does not break the lookup', () => {
		const form = formWith(`<input name='answers["q1"]'><input name='trap["x"]' aria-hidden="true">`)
		const internal = internalFieldNames(form, [], undefined)
		expect(internal.has('answers["q1"]')).toBe(false)
		expect(internal.has('trap["x"]')).toBe(true)
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
