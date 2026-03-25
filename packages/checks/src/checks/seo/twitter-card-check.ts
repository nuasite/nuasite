import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createTwitterCardCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/twitter-card',
		name: 'Twitter Card',
		domain: 'seo',
		defaultSeverity: 'info',
		description: 'Pages should have a twitter:card meta tag for rich social sharing',
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.twitterCard.card) {
				return [{
					message: 'Page is missing twitter:card meta tag',
					suggestion: 'Add <meta name="twitter:card" content="summary_large_image"> inside <head>',
				}]
			}
			return []
		},
	}
}
