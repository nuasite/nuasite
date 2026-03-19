import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createLazyLoadingCheck(): Check {
	return {
		kind: 'page',
		id: 'performance/lazy-loading',
		name: 'Lazy Loading',
		domain: 'performance',
		defaultSeverity: 'info',
		description: 'Below-the-fold images should use loading="lazy"',
		essential: false,
		run(ctx: PageCheckContext): CheckResult[] {
			const results: CheckResult[] = []
			const images = ctx.pageData.images

			for (let i = 2; i < images.length; i++) {
				const img = images[i]!
				if (img.loading !== 'lazy') {
					results.push({
						checkId: 'performance/lazy-loading',
						ruleName: 'Lazy Loading',
						domain: 'performance',
						severity: 'info',
						message: `Image "${img.src}" (position ${i + 1}) is missing loading="lazy"`,
						suggestion: 'Add loading="lazy" to below-the-fold images to improve initial page load',
						pagePath: ctx.pagePath,
						filePath: ctx.filePath,
						line: img.line,
					})
				}
			}
			return results
		},
	}
}
