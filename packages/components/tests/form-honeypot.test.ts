import { transform } from '@astrojs/compiler-rs'
import { experimental_AstroContainer } from 'astro/container'
import { plugin } from 'bun'
import { describe, expect, test } from 'bun:test'
import { cssTrapSelector, filledHoneypot } from '../src/form/utils.ts'

// Compiles `.astro` imports with Astro's own compiler, so the tests render the shipped component
plugin({
	name: 'astro-component',
	setup(build) {
		build.onLoad({ filter: /\.astro$/ }, async ({ path }) => {
			const result = transform(await Bun.file(path).text(), {
				filename: path,
				internalURL: 'astro/compiler-runtime',
				resolvePath: specifier => specifier,
			})
			return { contents: result.code, loader: 'ts' }
		})
	},
})

const renderForm = async () => {
	const { default: Form } = await import('../src/form/index.astro')
	const container = await experimental_AstroContainer.create()
	const html = await container.renderToString(Form, {
		props: { formId: 'contact' },
		slots: { default: '<label for="email">Email</label><input id="email" name="email"><button type="submit">Send</button>' },
	})
	// A parsed document does not run the component's script, which needs Vite to load
	const form = new DOMParser().parseFromString(html, 'text/html').querySelector('form')
	if (!form) throw new Error('The component rendered no form')
	return form
}

/** The honeypots as the component's script finds them: the named ones from `data-required-fields`, and the CSS trap. */
const honeypotInputs = (form: HTMLFormElement) => {
	const names = form.dataset.requiredFields?.split(',') ?? []
	const named = names.map(name => form.querySelector<HTMLInputElement>(`[name="${name}"]`))
	return [...named, form.querySelector<HTMLInputElement>(cssTrapSelector)].filter(input => input !== null)
}

const honeypotLabels = (form: HTMLFormElement) =>
	honeypotInputs(form).map(input => form.querySelector(`label[for="${input.id}"]`)).filter(label => label !== null)

/** Whether an element reaches the accessibility tree, as far as markup decides it: no hiding ancestor. */
const exposedToAssistiveTech = (element: Element) => element.closest('[aria-hidden="true"], [hidden], .hidden') === null

describe('Form honeypots', () => {
	test('renders four named honeypots and one CSS trap, each with a label', async () => {
		const form = await renderForm()
		expect(honeypotInputs(form)).toHaveLength(5)
		expect(honeypotLabels(form)).toHaveLength(5)
	})

	test('neither the honeypots nor their labels reach assistive technology', async () => {
		const form = await renderForm()
		const exposed = [...honeypotInputs(form), ...honeypotLabels(form)].filter(exposedToAssistiveTech)
		expect(exposed.map(element => element.textContent?.trim() || element.getAttribute('name'))).toEqual([])
		const ownField = form.querySelector('[name="email"]')
		expect(ownField && exposedToAssistiveTech(ownField)).toBe(true)
	})

	test('the honeypots are out of the tab order and closed to autofill', async () => {
		const form = await renderForm()
		for (const input of honeypotInputs(form)) {
			expect(input.getAttribute('tabindex')).toBe('-1')
			expect(input.getAttribute('autocomplete')).toBe('off')
		}
	})

	test('the honeypots are hidden visually without display:none, which bots skip', async () => {
		const form = await renderForm()
		for (const input of honeypotInputs(form)) {
			for (let element: HTMLElement | null = input; element; element = element.parentElement) {
				expect(element.hidden).toBe(false)
				expect(element.classList.contains('hidden')).toBe(false)
				expect(element.style.display).not.toBe('none')
			}
		}
		expect(form.querySelector<HTMLInputElement>(cssTrapSelector)?.style.left).toBe('-9999px')
	})

	test('a submission with a honeypot filled in fails the humanity check', async () => {
		const form = await renderForm()
		const names = form.dataset.requiredFields?.split(',') ?? []
		expect(filledHoneypot(form, names)).toBeNull()
		for (const input of honeypotInputs(form)) {
			input.value = 'https://spam.example'
			const expected = input.matches(cssTrapSelector) ? 'css_honeypot' : `honeypot:${input.name}`
			expect(filledHoneypot(form, names)).toBe(expected)
			input.value = ''
		}
	})
})
