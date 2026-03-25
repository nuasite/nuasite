import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createDescriptionMissingCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/description-missing',
		name: 'Meta Description Present',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Every page should have a meta description',
		essential: true,
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.metaDescription) {
				return [{ message: 'Page is missing a meta description', suggestion: 'Add <meta name="description" content="..."> inside <head>' }]
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
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.metaDescription) return []
			const { content, line } = ctx.pageData.metaDescription
			const results: CheckIssue[] = []

			if (content.length > maxLength) {
				results.push({
					message: `Meta description is ${content.length} characters (max: ${maxLength})`,
					suggestion: `Shorten to under ${maxLength} characters`,
					line,
					actual: `${content.length} characters`,
					expected: `${minLength}-${maxLength} characters`,
				})
			} else if (content.length < minLength) {
				results.push({
					message: `Meta description is ${content.length} characters (min: ${minLength})`,
					suggestion: `Expand to at least ${minLength} characters for better SEO`,
					line,
					actual: `${content.length} characters`,
					expected: `${minLength}-${maxLength} characters`,
				})
			}
			return results
		},
	}
}
