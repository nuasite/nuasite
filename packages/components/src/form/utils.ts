export const submitButtonRegex = /<button(?![^>]*type\s*=\s*["']button["'])[^>]*>|<input[^>]*type\s*=\s*["']submit["'][^>]*>/i
export const honeypotConflictRegex = /<input[^>]*name\s*=\s*["'][^"']*_required["'][^>]*>/i

export const honeypotFields = [
	{ name: `contact_required`, type: 'text' },
	{ name: `website_url_required`, type: 'url' },
	{ name: `phone_number_required`, type: 'tel' },
	{ name: `company_name_required`, type: 'text' },
] as const

/**
 * Name prefix of the CSS honeypot, which gets a random suffix per render. The script finds the trap by
 * this prefix: its name is on the page anyway (`name`, `id`, the label's `for`), and unlike the inline
 * style it survives an HTML minifier. A site field may not start with it (checked at render).
 */
export const cssTrapPrefix = 'css_trap_'
export const cssTrapSelector = `[name^="${cssTrapPrefix}"]`
export const cssTrapConflictRegex = new RegExp(`<(?:input|select|textarea)[^>]*\\sname\\s*=\\s*["']${cssTrapPrefix}`, 'i')

/** Marks a form's status box; `formStatusElements` looks it up inside the form, not by id on the page. */
export const formStatusAttribute = 'data-form-status'

export interface FormStatusElements {
	container: HTMLElement | null
	success: HTMLElement | null
	error: HTMLElement | null
	loading: HTMLElement | null
	submitAnyway: HTMLButtonElement | null
}

/**
 * The status box of one rendered form. A page can render the same `formId` twice (a callback form next to
 * the full contact form); a page-wide id lookup would give both the first form's box.
 */
export const formStatusElements = (form: HTMLFormElement): FormStatusElements => {
	const container = form.querySelector<HTMLElement>(`[${formStatusAttribute}]`)
	const error = container?.querySelector<HTMLElement>('[data-status="error"]') ?? null
	return {
		container,
		success: container?.querySelector<HTMLElement>('[data-status="success"]') ?? null,
		error,
		loading: container?.querySelector<HTMLElement>('[data-status="loading"]') ?? null,
		submitAnyway: error?.querySelector<HTMLButtonElement>('[data-action="submit-anyway"]') ?? null,
	}
}
