import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createHtmlSizeCheck(maxSize: number): Check {
	return {
		kind: 'page',
		id: 'performance/html-size',
		name: 'HTML Size',
		domain: 'performance',
		defaultSeverity: 'warning',
		description: `HTML document should be under ${(maxSize / 1024).toFixed(0)} KB`,
		essential: false,
		run(ctx: PageCheckContext): CheckResult[] {
			if (ctx.pageData.htmlSize > maxSize) {
				const actualKB = (ctx.pageData.htmlSize / 1024).toFixed(1)
				const maxKB = (maxSize / 1024).toFixed(1)
				return [{
					checkId: 'performance/html-size',
					ruleName: 'HTML Size',
					domain: 'performance',
					severity: 'warning',
					message: `HTML document is ${actualKB} KB (max: ${maxKB} KB)`,
					suggestion: 'Reduce HTML size by removing unnecessary markup, inlining less CSS, or splitting into multiple pages',
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
					actual: `${actualKB} KB`,
					expected: `<= ${maxKB} KB`,
				}]
			}
			return []
		},
	}
}
