import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createMetaDuplicateCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/meta-duplicate',
		name: 'No Duplicate Meta Tags',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Meta tags should not have duplicate name or property attributes',
		essential: false,
		run(ctx: PageCheckContext): CheckResult[] {
			const results: CheckResult[] = []
			const seen = new Map<string, number>()

			for (const tag of ctx.pageData.metaTags) {
				const key = tag.name ? `name:${tag.name}` : tag.property ? `property:${tag.property}` : null
				if (!key) continue

				const prevLine = seen.get(key)
				if (prevLine !== undefined) {
					const label = tag.name ? `name="${tag.name}"` : `property="${tag.property}"`
					results.push({
						checkId: 'seo/meta-duplicate',
						ruleName: 'No Duplicate Meta Tags',
						domain: 'seo',
						severity: 'warning',
						message: `Duplicate meta tag with ${label}`,
						suggestion: `Remove the duplicate <meta ${label}> tag (first seen at line ${prevLine})`,
						pagePath: ctx.pagePath,
						filePath: ctx.filePath,
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
