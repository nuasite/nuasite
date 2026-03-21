import type { Check, CheckIssue, PageCheckContext } from '../../types'

export function createRenderBlockingScriptCheck(): Check {
	return {
		kind: 'page',
		id: 'performance/render-blocking-script',
		name: 'Render-Blocking Scripts',
		domain: 'performance',
		defaultSeverity: 'warning',
		description: 'Scripts with src should use async, defer, or type="module" to avoid blocking rendering',
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			const results: CheckIssue[] = []
			for (const script of ctx.pageData.scripts) {
				if (!script.src) continue
				if (script.isAsync || script.isDefer) continue
				if (script.type === 'module') continue
				results.push({
					message: `Script "${script.src}" is render-blocking`,
					suggestion: 'Add async, defer, or type="module" to the script tag',
					line: script.line,
				})
			}
			return results
		},
	}
}
