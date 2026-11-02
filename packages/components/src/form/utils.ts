export const submitButtonRegex = /<button(?![^>]*type\s*=\s*["']button["'])[^>]*>|<input[^>]*type\s*=\s*["']submit["'][^>]*>/i
export const honeypotConflictRegex = /<input[^>]*name\s*=\s*["'][^"']*_required["'][^>]*>/i

export const honeypotFields = [
	{ name: `contact_required`, type: 'text' },
	{ name: `website_url_required`, type: 'url' },
	{ name: `phone_number_required`, type: 'tel' },
	{ name: `company_name_required`, type: 'text' },
] as const

/**
 * Inline style of the CSS honeypot. Its name is random per render and is not written anywhere else
 * on the page, so the script finds the field by this style instead.
 */
export const cssTrapStyle = 'position: absolute; left: -9999px; opacity: 0;'
export const cssTrapSelector = 'input[style*="position: absolute; left: -9999px"]'
