import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createFormLabelCheck(): Check {
	return {
		kind: 'page',
		id: 'accessibility/form-label',
		name: 'Form Labels',
		domain: 'accessibility',
		defaultSeverity: 'warning',
		description: 'Form inputs must have associated labels',
		essential: true,
		run(ctx: PageCheckContext): CheckIssue[] {
			const results: CheckIssue[] = []
			for (const form of ctx.pageData.forms) {
				for (const input of form.inputs) {
					if (!input.hasLabel) {
						const identifier = input.name ?? input.id ?? input.type
						results.push({
							message: `Input "${identifier}" is missing an associated label`,
							suggestion: 'Add a <label> element with a matching "for" attribute, or wrap the input in a <label>',
							line: input.line,
						})
					}
				}
			}
			return results
		},
	}
}
