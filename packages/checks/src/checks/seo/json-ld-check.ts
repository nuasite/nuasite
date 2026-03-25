import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createJsonLdInvalidCheck(): Check {
	return {
		kind: 'page',
		id: 'seo/json-ld-invalid',
		name: 'JSON-LD Valid',
		domain: 'seo',
		defaultSeverity: 'error',
		description: 'JSON-LD structured data must be valid',
		essential: true,
		run(ctx: PageCheckContext): CheckIssue[] {
			const results: CheckIssue[] = []
			for (const entry of ctx.pageData.jsonLd) {
				if (!entry.valid) {
					results.push({
						message: entry.error ?? `Invalid JSON-LD for type "${entry.type}"`,
						suggestion: 'Fix the JSON-LD structured data so it is valid JSON',
						line: entry.line,
					})
				}
			}
			return results
		},
	}
}
