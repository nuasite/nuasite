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
