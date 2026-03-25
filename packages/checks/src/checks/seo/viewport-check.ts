import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createViewportMissingCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/viewport-missing',
		name: 'Viewport Meta Tag',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Pages should have a viewport meta tag for mobile responsiveness',
		essential: true,
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.hasViewport) {
				return [{
					message: 'Page is missing a viewport meta tag',
					suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> inside <head>',
				}]
			}
			return []
		},
	}
}
