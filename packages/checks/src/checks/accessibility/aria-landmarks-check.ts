import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createAriaLandmarksCheck(): Check {
	return {
		kind: 'page',
		id: 'accessibility/aria-landmarks',
		name: 'ARIA Landmarks',
		domain: 'accessibility',
		defaultSeverity: 'info',
		description: 'Page should have a <main> landmark element',
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			const hasMain = ctx.root.querySelector('main') || ctx.root.querySelector('[role="main"]')
			if (!hasMain) {
				return [{
					message: 'Page is missing a <main> landmark element',
					suggestion: 'Wrap the primary content in a <main> element or add role="main" to the content container',
				}]
			}
			return []
		},
	}
}
