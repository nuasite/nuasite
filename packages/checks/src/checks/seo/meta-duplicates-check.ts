import type { Check, CheckIssue, PageCheckContext } from '../../types'

const ALLOWED_DUPLICATES = new Set([
	'property:og:image',
	'property:og:image:width',
	'property:og:image:height',
	'property:og:image:alt',
	'property:og:locale:alternate',
])

export function createMetaDuplicateCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/meta-duplicate',
		name: 'No Duplicate Meta Tags',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Meta tags should not have duplicate name or property attributes',
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			const results: CheckIssue[] = []
			const seen = new Map<string, number>()

			for (const tag of ctx.pageData.metaTags) {
				const key = tag.name ? `name:${tag.name}` : tag.property ? `property:${tag.property}` : null
				if (!key) continue
				if (ALLOWED_DUPLICATES.has(key)) continue

				const prevLine = seen.get(key)
				if (prevLine !== undefined) {
					const label = tag.name ? `name="${tag.name}"` : `property="${tag.property}"`
					results.push({
						message: `Duplicate meta tag with ${label}`,
						suggestion: `Remove the duplicate <meta ${label}> tag (first seen at line ${prevLine})`,
						line: tag.line,
					})
				} else {
					seen.set(key, tag.line)
				}
			}
			return results
		},
	}
}
