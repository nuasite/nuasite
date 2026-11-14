import { afterEach, describe, expect, test } from 'bun:test'
import { formStatusElements } from '../src/form/utils.ts'

/** The status box as the component renders it, with the id it shares with any other form of the same formId. */
const renderedForm = (formId: string, name: string) => {
	const form = document.createElement('form')
	form.dataset.formId = formId
	form.dataset.name = name
	form.innerHTML = `
		<input name="phone">
		<button type="submit">Send</button>
		<div id="${formId}-status" data-form-status class="mt-4 hidden" role="alert">
			<div data-status="success" class="hidden"><span></span></div>
			<div data-status="error" class="hidden">
				<div><span></span></div>
				<button type="button" data-action="submit-anyway" class="hidden">Send anyway</button>
			</div>
			<div data-status="loading" class="hidden"><span></span></div>
		</div>
	`
	document.body.append(form)
	return form
}

afterEach(() => {
	document.body.innerHTML = ''
})

describe('formStatusElements', () => {
	test('two forms with the same formId on one page each get their own status box', () => {
		renderedForm('contact', 'contact')
		const callback = renderedForm('contact', 'callback')

		// By attribute, not identity: happy-dom hands out a proxy for a form, so `===` and `contains` fail on it.
		const own = formStatusElements(callback)
		const owners = [own.container, own.success, own.error, own.loading, own.submitAnyway].map(element => element?.closest('form')?.dataset.name)
		expect(owners).toEqual(['callback', 'callback', 'callback', 'callback', 'callback'])
	})

	test("a form without a status box gets nulls, not another form's box", () => {
		renderedForm('contact', 'contact')
		const bare = document.createElement('form')
		document.body.append(bare)
		expect(formStatusElements(bare)).toEqual({ container: null, success: null, error: null, loading: null, submitAnyway: null })
	})
})
