import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createDescriptionMissingCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/description-missing',
		name: 'Meta Description Present',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Every page should have a meta description',
		essential: true,
		run(ctx: PageCheckContext): CheckResult[] {
			if (!ctx.pageData.metaDescription) {
				return [{
					checkId: 'seo/description-missing',
					ruleName: 'Meta Description Present',
					domain: 'seo',
					severity: 'warning',
					message: 'Page is missing a meta description',
					suggestion: 'Add <meta name="description" content="..."> inside <head>',
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
				}]
			}
			return []
		},
	}
}

export function createDescriptionLengthCheck(minLength: number, maxLength: number): Check {
	return {
		kind: 'page',
		id: 'seo/description-length',
		name: 'Meta Description Length',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: `Meta description should be ${minLength}-${maxLength} characters`,
		essential: true,
		run(ctx: PageCheckContext): CheckResult[] {
			if (!ctx.pageData.metaDescription) return []
			const { content, line } = ctx.pageData.metaDescription
			const results: CheckResult[] = []

			if (content.length > maxLength) {
				results.push({
					checkId: 'seo/description-length',
					ruleName: 'Meta Description Length',
					domain: 'seo',
					severity: 'warning',
					message: `Meta description is ${content.length} characters (max: ${maxLength})`,
					suggestion: `Shorten to under ${maxLength} characters`,
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
					line,
					actual: `${content.length} characters`,
					expected: `${minLength}-${maxLength} characters`,
				})
			} else if (content.length < minLength) {
				results.push({
					checkId: 'seo/description-length',
					ruleName: 'Meta Description Length',
					domain: 'seo',
					severity: 'warning',
					message: `Meta description is ${content.length} characters (min: ${minLength})`,
					suggestion: `Expand to at least ${minLength} characters for better SEO`,
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
					line,
					actual: `${content.length} characters`,
					expected: `${minLength}-${maxLength} characters`,
				})
			}
			return results
		},
	}
}
