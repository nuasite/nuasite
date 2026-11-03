import { describe, expect, test } from 'bun:test'
import { internalFieldNames, responseErrorReason, trackedFields } from '../src/form/tracking.ts'
import { cssTrapConflictRegex, cssTrapSelector } from '../src/form/utils.ts'

/**
 * A form with the fields the component renders around the slot, plus `slot` for the site's own. The
 * trap's style is passed in, so a test can render it the way a minifier would leave it.
 */
const renderedForm = (slot: string, trapStyle = 'position: absolute; left: -9999px; opacity: 0;') => {
	const form = document.createElement('form')
	form.innerHTML = `
		<input name="contact_required" aria-hidden="true">
		<input name="website_url_required" aria-hidden="true">
		<input name="css_trap_9f8e7d6c" style="${trapStyle}" aria-hidden="true">
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

	test('finds the CSS trap whatever its style looks like', () => {
		for (const style of ['position:absolute;left:-9999px;opacity:0', '']) {
			expect(internalFieldNames(renderedForm('', style), 'token_ab12cd34').has('css_trap_9f8e7d6c')).toBe(true)
		}
	})

	test('the spam check finds the trap with the same selector', () => {
		const trap = renderedForm('', 'position:absolute;left:-9999px').querySelector<HTMLInputElement>(cssTrapSelector)
		expect(trap?.name).toBe('css_trap_9f8e7d6c')
	})

	test('a site field hidden from assistive tech is still a visitor field', () => {
		const form = renderedForm('<input type="checkbox" name="newsletter" aria-hidden="true" tabindex="-1">')
		expect(internalFieldNames(form, 'token_ab12cd34').has('newsletter')).toBe(false)
	})

	test('a visitor field that merely starts with token_ is not internal', () => {
		expect(internalFieldNames(renderedForm('<input name="token_code">'), 'token_ab12cd34').has('token_code')).toBe(false)
	})

	test('what goes to analytics from a rendered form is the visitor fields only', () => {
		const form = renderedForm('<input name="email" value="jana@example.com"><textarea name="message">Dobrý den</textarea>')
		const entries = [...form.querySelectorAll<HTMLInputElement>('[name]')].map((field): [string, string] => [field.name, field.value])
		expect(trackedFields(entries, internalFieldNames(form, 'token_ab12cd34'))).toEqual({ email: '', message: '' })
	})
})

describe('cssTrapConflictRegex', () => {
	test('a site field named with the trap prefix is refused at render', () => {
		expect(cssTrapConflictRegex.test('<input type="text" name="css_trap_x">')).toBe(true)
		expect(cssTrapConflictRegex.test("<textarea\nname='css_trap_note'>")).toBe(true)
	})

	test('other names and attributes that merely end in name pass', () => {
		expect(cssTrapConflictRegex.test('<input name="email">')).toBe(false)
		expect(cssTrapConflictRegex.test('<input data-name="css_trap_x" name="email">')).toBe(false)
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
