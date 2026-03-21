import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createInlineSizeCheck(maxSize: number): Check {
	return {
		kind: 'page',
		id: 'performance/inline-size',
		name: 'Inline Resource Size',
		domain: 'performance',
		defaultSeverity: 'warning',
		description: `Inline scripts and styles should total under ${(maxSize / 1024).toFixed(0)} KB`,
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			const totalInline = ctx.pageData.inlineScriptBytes + ctx.pageData.inlineStyleBytes
			if (totalInline > maxSize) {
				const actualKB = (totalInline / 1024).toFixed(1)
				const maxKB = (maxSize / 1024).toFixed(1)
				const scriptKB = (ctx.pageData.inlineScriptBytes / 1024).toFixed(1)
				const styleKB = (ctx.pageData.inlineStyleBytes / 1024).toFixed(1)
				return [{
					message: `Inline resources total ${actualKB} KB (scripts: ${scriptKB} KB, styles: ${styleKB} KB, max: ${maxKB} KB)`,
					suggestion: 'Move large inline scripts and styles to external files for better caching',
					actual: `${actualKB} KB`,
					expected: `<= ${maxKB} KB`,
				}]
			}
			return []
		},
	}
}
