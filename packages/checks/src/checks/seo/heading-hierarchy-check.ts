import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createMultipleH1Check(): Check {
	return {
		kind: 'page',
		id: 'seo/multiple-h1',
		name: 'Single H1',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Each page should have only one <h1> element',
		essential: true,
		run(ctx: PageCheckContext): CheckResult[] {
			const h1s = ctx.pageData.headings.filter(h => h.level === 1)
			if (h1s.length > 1) {
				const second = h1s[1]!
				return [{
					checkId: 'seo/multiple-h1',
					ruleName: 'Single H1',
					domain: 'seo',
					severity: 'warning',
					message: `Page has ${h1s.length} <h1> elements (expected 1)`,
					suggestion: 'Use only one <h1> per page; use <h2>-<h6> for sub-headings',
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
					line: second.line,
					actual: `${h1s.length} h1 elements`,
					expected: '1 h1 element',
				}]
			}
			return []
		},
	}
}

export function createNoH1Check(): Check {
	return {
		kind: 'page',
		id: 'seo/no-h1',
		name: 'H1 Present',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Each page should have an <h1> element',
		essential: true,
		run(ctx: PageCheckContext): CheckResult[] {
			const h1s = ctx.pageData.headings.filter(h => h.level === 1)
			if (h1s.length === 0) {
				return [{
					checkId: 'seo/no-h1',
					ruleName: 'H1 Present',
					domain: 'seo',
					severity: 'warning',
					message: 'Page is missing an <h1> element',
					suggestion: 'Add an <h1> heading to identify the main topic of the page',
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
				}]
			}
			return []
		},
	}
}

export function createHeadingSkipCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/heading-skip',
		name: 'Heading Hierarchy',
		domain: 'seo',
		defaultSeverity: 'info',
		description: 'Heading levels should not be skipped (e.g. h1 followed by h3)',
		essential: false,
		run(ctx: PageCheckContext): CheckResult[] {
			const results: CheckResult[] = []
			const { headings } = ctx.pageData
			for (let i = 1; i < headings.length; i++) {
				const prev = headings[i - 1]!
				const curr = headings[i]!
				if (curr.level > prev.level + 1) {
					results.push({
						checkId: 'seo/heading-skip',
						ruleName: 'Heading Hierarchy',
						domain: 'seo',
						severity: 'info',
						message: `Heading level skipped from <h${prev.level}> to <h${curr.level}>`,
						suggestion: `Use <h${prev.level + 1}> instead of <h${curr.level}>, or add the missing intermediate heading`,
						pagePath: ctx.pagePath,
						filePath: ctx.filePath,
						line: curr.line,
						actual: `h${prev.level} → h${curr.level}`,
						expected: `h${prev.level} → h${prev.level + 1}`,
					})
				}
			}
			return results
		},
	}
}
