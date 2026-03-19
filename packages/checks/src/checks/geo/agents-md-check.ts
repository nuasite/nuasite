import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { CheckResult, SiteCheck, SiteCheckContext } from '../../types'

export function createAgentsMdCheck(): SiteCheck {
	return {
		kind: 'site',
		id: 'geo/agents-md',
		name: 'AGENTS.md',
		domain: 'geo',
		defaultSeverity: 'warning',
		description: 'Project should have an AGENTS.md file with page summaries',
		essential: true,
		run(_ctx: SiteCheckContext): CheckResult[] {
			// AGENTS.md lives in the project root, not dist
			const agentsPath = path.join(process.cwd(), 'AGENTS.md')
			let content: string | undefined
			try {
				content = readFileSync(agentsPath, 'utf-8')
			} catch {
				return [{
					checkId: 'geo/agents-md',
					ruleName: 'AGENTS.md',
					domain: 'geo',
					severity: 'warning',
					message: 'Project is missing an AGENTS.md file',
					suggestion: 'Add an AGENTS.md file to make your site discoverable by AI agents',
					pagePath: '/AGENTS.md',
				}]
			}

			if (!content.includes('<page_summary>')) {
				return [{
					checkId: 'geo/agents-md',
					ruleName: 'AGENTS.md',
					domain: 'geo',
					severity: 'warning',
					message: 'AGENTS.md does not contain any <page_summary> markers',
					suggestion: 'Use @nuasite/agent-summary to generate page summaries in AGENTS.md',
					pagePath: '/AGENTS.md',
				}]
			}
			return []
		},
	}
}
