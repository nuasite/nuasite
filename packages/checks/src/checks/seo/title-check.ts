import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createTitleMissingCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/title-missing',
		name: 'Title Present',
		domain: 'seo',
		defaultSeverity: 'error',
		description: 'Every page must have a <title> element',
		essential: true,
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.title) {
				return [{ message: 'Page is missing a <title> element', suggestion: 'Add a <title> tag inside <head>' }]
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
		run(ctx: PageCheckContext): CheckIssue[] {
			if (ctx.pageData.title && ctx.pageData.title.content.length === 0) {
				return [{ message: 'Page title is empty', suggestion: 'Add meaningful text to the <title> element', line: ctx.pageData.title.line }]
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
		run(ctx: PageCheckContext): CheckIssue[] {
			if (!ctx.pageData.title) return []
			const { content, line } = ctx.pageData.title
			if (content.length > maxLength) {
				return [{
					message: `Title is ${content.length} characters (max: ${maxLength})`,
					suggestion: `Shorten the title to under ${maxLength} characters`,
					line,
					actual: content,
					expected: `<= ${maxLength} characters`,
				}]
			}
			return []
		},
	}
}
