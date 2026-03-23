import { buildPoorTextSet, poorImageAlts } from '../../i18n/poor-texts'
import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createImageAltQualityCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/image-alt-quality',
		name: 'Image Alt Text Quality',
		domain: 'seo',
		defaultSeverity: 'info',
		description: 'Image alt text should be descriptive, not generic',
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			const poorAlts = buildPoorTextSet(poorImageAlts, ctx.pageData.htmlLang)
			const results: CheckIssue[] = []
			for (const image of ctx.pageData.images) {
				if (image.alt === undefined || image.alt === '') continue
				const trimmed = image.alt.trim()
				if (poorAlts.has(trimmed.toLowerCase())) {
					results.push({
						message: `Image has generic alt text "${trimmed}": ${image.src}`,
						suggestion: 'Use descriptive alt text that explains the image content, e.g. "Team photo at annual retreat" instead of "photo"',
						line: image.line,
						actual: trimmed,
					})
				}
			}
			return results
		},
	}
}
