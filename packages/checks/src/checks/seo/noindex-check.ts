import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createNoindexDetectedCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/noindex-detected',
		name: 'Noindex Detection',
		domain: 'seo',
		defaultSeverity: 'info',
		description: 'Detects pages with noindex meta tag that will be excluded from search engines',
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			if (ctx.pageData.hasNoindex) {
				return [{
					message: 'Page has a noindex directive and will not appear in search results',
					suggestion: 'Remove the noindex directive if this page should be indexed by search engines',
				}]
			}
			return []
		},
	}
}
