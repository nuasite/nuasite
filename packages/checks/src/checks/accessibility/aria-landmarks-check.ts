import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createAriaLandmarksCheck(): Check {
	return {
		kind: 'page',
		id: 'accessibility/aria-landmarks',
		name: 'ARIA Landmarks',
		domain: 'accessibility',
		defaultSeverity: 'info',
		description: 'Page should have a <main> landmark element',
		essential: false,
		run(ctx: PageCheckContext): CheckResult[] {
			const hasMain = ctx.root.querySelector('main') || ctx.root.querySelector('[role="main"]')
			if (!hasMain) {
				return [{
					checkId: 'accessibility/aria-landmarks',
					ruleName: 'ARIA Landmarks',
					domain: 'accessibility',
					severity: 'info',
					message: 'Page is missing a <main> landmark element',
					suggestion: 'Wrap the primary content in a <main> element or add role="main" to the content container',
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
				}]
			}
			return []
		},
	}
}
