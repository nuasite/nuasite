import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createImageAltMissingCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/image-alt-missing',
		name: 'Image Alt Text',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Images should have an alt attribute',
		essential: false,
		run(ctx: PageCheckContext): CheckResult[] {
			const results: CheckResult[] = []
			for (const image of ctx.pageData.images) {
				if (image.alt === undefined) {
					results.push({
						checkId: 'seo/image-alt-missing',
						ruleName: 'Image Alt Text',
						domain: 'seo',
						severity: 'warning',
						message: `Image is missing an alt attribute: ${image.src}`,
						suggestion: 'Add an alt attribute describing the image, or alt="" if the image is decorative',
						pagePath: ctx.pagePath,
						filePath: ctx.filePath,
						line: image.line,
						actual: 'no alt attribute',
						expected: 'alt="descriptive text" or alt=""',
					})
				}
			}
			return results
		},
	}
}
