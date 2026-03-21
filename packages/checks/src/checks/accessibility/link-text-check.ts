import type { Check, CheckIssue, PageCheckContext } from '../../types'

const POOR_LINK_TEXTS = ['click here', 'read more', 'here', 'link', 'more']

export function createLinkTextCheck(): Check {
	return {
		kind: 'page',
		id: 'accessibility/link-text',
		name: 'Descriptive Link Text',
		domain: 'accessibility',
		defaultSeverity: 'info',
		description: 'Links should have descriptive text instead of generic phrases',
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			const results: CheckIssue[] = []
			for (const link of ctx.pageData.links) {
				const text = link.text.trim().toLowerCase()
				if (POOR_LINK_TEXTS.includes(text)) {
					results.push({
						message: `Link with text "${link.text.trim()}" is not descriptive`,
						suggestion: 'Use descriptive text that explains where the link goes, e.g. "View pricing details" instead of "click here"',
						line: link.line,
						actual: link.text.trim(),
					})
				}
			}
			return results
		},
	}
}
