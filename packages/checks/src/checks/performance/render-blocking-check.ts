import type { Check, CheckResult, PageCheckContext } from '../../types'

export function createRenderBlockingScriptCheck(): Check {
	return {
		kind: 'page',
		id: 'performance/render-blocking-script',
		name: 'Render-Blocking Scripts',
		domain: 'performance',
		defaultSeverity: 'warning',
		description: 'Scripts with src should use async, defer, or type="module" to avoid blocking rendering',
		essential: false,
		run(ctx: PageCheckContext): CheckResult[] {
			const results: CheckResult[] = []
			for (const script of ctx.pageData.scripts) {
				if (!script.src) continue
				if (script.isAsync || script.isDefer) continue
				if (script.type === 'module') continue

				results.push({
					checkId: 'performance/render-blocking-script',
					ruleName: 'Render-Blocking Scripts',
					domain: 'performance',
					severity: 'warning',
					message: `Script "${script.src}" is render-blocking`,
					suggestion: 'Add async, defer, or type="module" to the script tag',
					pagePath: ctx.pagePath,
					filePath: ctx.filePath,
					line: script.line,
				})
			}
			return results
		},
	}
}
