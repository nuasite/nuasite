import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createLangAttributeCheck(): Check {
	return {
		kind: 'page',
		id: 'accessibility/lang-attribute',
		name: 'Lang Attribute',
		domain: 'accessibility',
		defaultSeverity: 'warning',
		description: 'HTML element should have a lang attribute',
		essential: true,
		run(ctx: PageCheckContext): CheckResult[] {
			if (!ctx.pageData.htmlLang) {
				return [{
					checkId: 'accessibility/lang-attribute',
					ruleName: 'Lang Attribute',
					domain: 'accessibility',
					severity: 'warning',
					message: 'Page is missing a lang attribute on the <html> element',
					suggestion: 'Add lang="en" (or appropriate language code) to the <html> tag',
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
				}]
			}
			return []
		},
	}
}
