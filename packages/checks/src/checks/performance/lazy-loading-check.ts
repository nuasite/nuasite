import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createLazyLoadingCheck(): Check {
	return {
		kind: 'page',
		id: 'performance/lazy-loading',
		name: 'Lazy Loading',
		domain: 'performance',
		defaultSeverity: 'info',
		description: 'Below-the-fold images should use loading="lazy"',
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			const results: CheckIssue[] = []
			const images = ctx.pageData.images
			for (let i = 2; i < images.length; i++) {
				const img = images[i]!
				if (img.loading === 'eager') continue
				if (img.loading !== 'lazy') {
					results.push({
						message: `Image "${img.src}" (position ${i + 1}) is missing loading="lazy"`,
						suggestion: 'Add loading="lazy" to below-the-fold images to improve initial page load',
						line: img.line,
					})
				}
			}
			return results
		},
	}
}
