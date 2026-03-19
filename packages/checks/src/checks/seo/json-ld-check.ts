import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createJsonLdInvalidCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/json-ld-invalid',
		name: 'JSON-LD Valid',
		domain: 'seo',
		defaultSeverity: 'error',
		description: 'JSON-LD structured data must be valid',
		essential: true,
		run(ctx: PageCheckContext): CheckResult[] {
			const results: CheckResult[] = []
			for (const entry of ctx.pageData.jsonLd) {
				if (!entry.valid) {
					results.push({
						checkId: 'seo/json-ld-invalid',
						ruleName: 'JSON-LD Valid',
						domain: 'seo',
						severity: 'error',
						message: entry.error ?? `Invalid JSON-LD for type "${entry.type}"`,
						suggestion: 'Fix the JSON-LD structured data so it is valid JSON',
						pagePath: ctx.pagePath,
						filePath: ctx.filePath,
						line: entry.line,
					})
				}
			}
			return results
		},
	}
}
