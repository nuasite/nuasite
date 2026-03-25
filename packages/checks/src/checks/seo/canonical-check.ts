import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createCanonicalMissingCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/canonical-missing',
		name: 'Canonical URL Present',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Every page should have a canonical URL',
		essential: true,
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.canonical) {
				return [{ message: 'Page is missing a canonical URL', suggestion: 'Add <link rel="canonical" href="..."> inside <head>' }]
			}
			return []
		},
	}
}

export function createCanonicalMismatchCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/canonical-mismatch',
		name: 'Canonical URL Matches Page',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Canonical URL should point to the current page',
		essential: true,
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.canonical) return []
			const { href, line } = ctx.pageData.canonical
			try {
				const canonicalPath = new URL(href).pathname.replace(/\/+$/, '') || '/'
				const pagePath = ctx.pagePath.replace(/\/+$/, '') || '/'
				if (canonicalPath !== pagePath) {
					return [{
						message: 'Canonical URL does not match the page path',
						suggestion: `Update the canonical URL to point to this page's own URL`,
						line,
						actual: href,
						expected: ctx.pagePath,
					}]
				}
			} catch {
				// Invalid URL — handled by canonical-invalid check
			}
			return []
		},
	}
}

export function createCanonicalInvalidCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/canonical-invalid',
		name: 'Canonical URL Valid',
		domain: 'seo',
		defaultSeverity: 'error',
		description: 'Canonical URL must be a valid absolute URL',
		essential: true,
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.canonical) return []
			const { href, line } = ctx.pageData.canonical
			if (!href.startsWith('http://') && !href.startsWith('https://')) {
				return [{
					message: 'Canonical URL is not a valid absolute URL',
					suggestion: 'Use an absolute URL starting with http:// or https://',
					line,
					actual: href,
					expected: 'Absolute URL (http:// or https://)',
				}]
			}
			return []
		},
	}
}
