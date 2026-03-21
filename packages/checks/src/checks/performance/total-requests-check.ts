import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createTotalRequestsCheck(maxRequests: number): Check {
	return {
		kind: 'page',
		id: 'performance/total-requests',
		name: 'Total External Requests',
		domain: 'performance',
		defaultSeverity: 'info',
		description: `Page should load fewer than ${maxRequests} external resources`,
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			const externalScripts = ctx.pageData.scripts.filter(s => s.src).length
			const externalStyles = ctx.pageData.stylesheets.length
			const total = externalScripts + externalStyles
			if (total > maxRequests) {
				return [{
					message: `Page loads ${total} external resources (${externalScripts} scripts, ${externalStyles} stylesheets, max: ${maxRequests})`,
					suggestion: 'Bundle scripts and stylesheets to reduce the number of HTTP requests',
					actual: `${total} requests`,
					expected: `<= ${maxRequests} requests`,
				}]
			}
			return []
		},
	}
}
