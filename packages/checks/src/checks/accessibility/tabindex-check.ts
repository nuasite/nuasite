import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createTabindexCheck(): Check {
	return {
		kind: 'page',
		id: 'accessibility/tabindex',
		name: 'Positive Tabindex',
		domain: 'accessibility',
		defaultSeverity: 'warning',
		description: 'Elements should not have a positive tabindex value',
		essential: false,
		run(ctx: PageCheckContext): CheckResult[] {
			const results: CheckResult[] = []
			const elements = ctx.root.querySelectorAll('[tabindex]')
			for (const el of elements) {
				const tabindex = parseInt(el.getAttribute('tabindex') ?? '0', 10)
				if (tabindex > 0) {
					const tag = el.tagName?.toLowerCase() ?? 'unknown'
					results.push({
						checkId: 'accessibility/tabindex',
						ruleName: 'Positive Tabindex',
						domain: 'accessibility',
						severity: 'warning',
						message: `<${tag}> element has tabindex="${tabindex}" which disrupts natural tab order`,
						suggestion: 'Use tabindex="0" to make an element focusable in natural order, or tabindex="-1" for programmatic focus only',
						pagePath: ctx.pagePath,
						filePath: ctx.filePath,
					})
				}
			}
			return results
		},
	}
}
