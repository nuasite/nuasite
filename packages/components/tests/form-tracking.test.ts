import { describe, expect, test } from 'bun:test'
import { internalFieldNames, responseErrorReason, trackedFields } from '../src/form/tracking.ts'
import { cssTrapStyle } from '../src/form/utils.ts'

/** A form with the fields the component renders around the slot, plus `slot` for the site's own. */
const renderedForm = (slot: string) => {
	const form = document.createElement('form')
	form.innerHTML = `
		<input name="contact_required" aria-hidden="true">
		<input name="website_url_required" aria-hidden="true">
		<input name="css_trap_9f8e7d6c" style="${cssTrapStyle}" aria-hidden="true">
		${slot}
		<input type="hidden" name="token_ab12cd34">
	`
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
	test('collects the honeypots, the CSS trap and the token', () => {
		const internal = internalFieldNames(renderedForm('<input name="email">'), 'token_ab12cd34')
		const honeypots = ['company_name_required', 'contact_required', 'phone_number_required', 'website_url_required']
		expect([...internal].sort()).toEqual([...honeypots, 'css_trap_9f8e7d6c', 'token_ab12cd34'].sort())
	})

	test('a site field hidden from assistive tech is still a visitor field', () => {
		const form = renderedForm('<input type="checkbox" name="newsletter" aria-hidden="true" tabindex="-1">')
		expect(internalFieldNames(form, 'token_ab12cd34').has('newsletter')).toBe(false)
	})

	test('a visitor field that merely starts with token_ is not internal', () => {
		expect(internalFieldNames(renderedForm('<input name="token_code">'), 'token_ab12cd34').has('token_code')).toBe(false)
	})

	test('a field name with quotes or brackets does not break the lookup', () => {
		const form = renderedForm(`<input name='answers["q1"]' aria-hidden="true">`)
		expect(internalFieldNames(form, 'token_ab12cd34').has('answers["q1"]')).toBe(false)
	})

	test('what goes to analytics from a rendered form is the visitor fields only', () => {
		const form = renderedForm('<input name="email" value="jana@example.com"><textarea name="message">Dobrý den</textarea>')
		const entries = [...form.querySelectorAll<HTMLInputElement>('[name]')].map((field): [string, string] => [field.name, field.value])
		expect(trackedFields(entries, internalFieldNames(form, 'token_ab12cd34'))).toEqual({ email: '', message: '' })
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
