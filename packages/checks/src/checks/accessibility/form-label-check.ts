import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createFormLabelCheck(): Check {
	return {
		kind: 'page',
		id: 'accessibility/form-label',
		name: 'Form Labels',
		domain: 'accessibility',
		defaultSeverity: 'warning',
		description: 'Form inputs must have associated labels',
		essential: true,
		run(ctx: PageCheckContext): CheckResult[] {
			const results: CheckResult[] = []
			for (const form of ctx.pageData.forms) {
				for (const input of form.inputs) {
					if (!input.hasLabel) {
						const identifier = input.name ?? input.id ?? input.type
						results.push({
							checkId: 'accessibility/form-label',
							ruleName: 'Form Labels',
							domain: 'accessibility',
							severity: 'warning',
							message: `Input "${identifier}" is missing an associated label`,
							suggestion: 'Add a <label> element with a matching "for" attribute, or wrap the input in a <label>',
							pagePath: ctx.pagePath,
							filePath: ctx.filePath,
							line: input.line,
						})
					}
				}
			}
			return results
		},
	}
}
