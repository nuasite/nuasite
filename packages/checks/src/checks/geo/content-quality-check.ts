import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createContentTooShortCheck(minLength: number): Check {
	return {
		kind: 'page',
		id: 'geo/content-too-short',
		name: 'Content Length',
		domain: 'geo',
		defaultSeverity: 'info',
		description: `Page content should be at least ${minLength} characters`,
		essential: false,
		run(ctx: PageCheckContext): CheckResult[] {
			const length = ctx.pageData.bodyTextLength
			if (length < minLength) {
				return [{
					checkId: 'geo/content-too-short',
					ruleName: 'Content Length',
					domain: 'geo',
					severity: 'info',
					message: `Page content is ${length} characters (min: ${minLength})`,
					suggestion: `Add more meaningful content to reach at least ${minLength} characters`,
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
					actual: `${length} characters`,
					expected: `>= ${minLength} characters`,
				}]
			}
			return []
		},
	}
}

export function createInsufficientHeadingsCheck(minHeadings: number): Check {
	return {
		kind: 'page',
		id: 'geo/insufficient-headings',
		name: 'Heading Count',
		domain: 'geo',
		defaultSeverity: 'info',
		description: `Page should have at least ${minHeadings} headings for structure`,
		essential: false,
		run(ctx: PageCheckContext): CheckResult[] {
			if (ctx.pageData.headings.length < minHeadings) {
				return [{
					checkId: 'geo/insufficient-headings',
					ruleName: 'Heading Count',
					domain: 'geo',
					severity: 'info',
					message: `Page has ${ctx.pageData.headings.length} heading(s) (min: ${minHeadings})`,
					suggestion: `Add more headings to improve content structure and LLM comprehension`,
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
					actual: `${ctx.pageData.headings.length} headings`,
					expected: `>= ${minHeadings} headings`,
				}]
			}
			return []
		},
	}
}
