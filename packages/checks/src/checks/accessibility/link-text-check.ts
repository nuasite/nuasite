import { buildPoorTextSet, poorLinkTexts } from '../../i18n/poor-texts'
import type { Check, CheckIssue, PageCheckContext } from '../../types'

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
			const poorTexts = buildPoorTextSet(poorLinkTexts, ctx.pageData.htmlLang)
			const results: CheckIssue[] = []
			for (const link of ctx.pageData.links) {
				const trimmed = link.text.trim()
				if (poorTexts.has(trimmed.toLowerCase())) {
					results.push({
						message: `Link with text "${trimmed}" is not descriptive`,
						suggestion: 'Use descriptive text that explains where the link goes, e.g. "View pricing details" instead of "click here"',
						line: link.line,
						actual: trimmed,
					})
				}
			}
			return results
		},
	}
}
