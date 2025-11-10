export const submitButtonRegex = /<button(?![^>]*type\s*=\s*["']button["'])[^>]*>|<input[^>]*type\s*=\s*["']submit["'][^>]*>/i
export const honeypotConflictRegex = /<input[^>]*name\s*=\s*["'][^"']*_required["'][^>]*>/i

export const honeypotFields = [
	{ name: `contact_required`, type: 'text' },
	{ name: `website_url_required`, type: 'url' },
	{ name: `phone_number_required`, type: 'tel' },
	{ name: `company_name_required`, type: 'text' },
] as const;
