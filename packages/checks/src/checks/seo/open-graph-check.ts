import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createOgTitleCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/og-title',
		name: 'Open Graph Title',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Pages should have an og:title meta tag',
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.openGraph.title) {
				return [{ message: 'Page is missing og:title meta tag', suggestion: 'Add <meta property="og:title" content="..."> inside <head>' }]
			}
			return []
		},
	}
}

export function createOgDescriptionCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/og-description',
		name: 'Open Graph Description',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Pages should have an og:description meta tag',
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.openGraph.description) {
				return [{ message: 'Page is missing og:description meta tag', suggestion: 'Add <meta property="og:description" content="..."> inside <head>' }]
			}
			return []
		},
	}
}

export function createOgImageCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/og-image',
		name: 'Open Graph Image',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Pages should have an og:image meta tag',
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.openGraph.image) {
				return [{ message: 'Page is missing og:image meta tag', suggestion: 'Add <meta property="og:image" content="..."> inside <head>' }]
			}
			return []
		},
	}
}
