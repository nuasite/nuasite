import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createTitleMissingCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/title-missing',
		name: 'Title Present',
		domain: 'seo',
		defaultSeverity: 'error',
		description: 'Every page must have a <title> element',
		essential: true,
		run(ctx: PageCheckContext): CheckResult[] {
			if (!ctx.pageData.title) {
				return [{
					checkId: 'seo/title-missing',
					ruleName: 'Title Present',
					domain: 'seo',
					severity: 'error',
					message: 'Page is missing a <title> element',
					suggestion: 'Add a <title> tag inside <head>',
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
				}]
			}
			return []
		},
	}
}

export function createTitleEmptyCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/title-empty',
		name: 'Title Not Empty',
		domain: 'seo',
		defaultSeverity: 'error',
		description: 'Page title must not be empty',
		essential: true,
		run(ctx: PageCheckContext): CheckResult[] {
			if (ctx.pageData.title && ctx.pageData.title.content.length === 0) {
				return [{
					checkId: 'seo/title-empty',
					ruleName: 'Title Not Empty',
					domain: 'seo',
					severity: 'error',
					message: 'Page title is empty',
					suggestion: 'Add meaningful text to the <title> element',
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
					line: ctx.pageData.title.line,
				}]
			}
			return []
		},
	}
}

export function createTitleLengthCheck(maxLength: number): Check {
	return {
		kind: 'page',
		id: 'seo/title-length',
		name: 'Title Length',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: `Title should be under ${maxLength} characters`,
		essential: true,
		run(ctx: PageCheckContext): CheckResult[] {
			if (!ctx.pageData.title) return []
			const { content, line } = ctx.pageData.title
			if (content.length > maxLength) {
				return [{
					checkId: 'seo/title-length',
					ruleName: 'Title Length',
					domain: 'seo',
					severity: 'warning',
					message: `Title is ${content.length} characters (max: ${maxLength})`,
					suggestion: `Shorten the title to under ${maxLength} characters`,
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
					line,
					actual: content,
					expected: `<= ${maxLength} characters`,
				}]
			}
			return []
		},
	}
}
