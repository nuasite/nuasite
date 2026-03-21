import fs from 'node:fs/promises'
import path from 'node:path'
import type { SiteCheck, SiteCheckContext, SiteCheckIssue } from '../../types'

export function createAgentsMdCheck(): SiteCheck {
	return {
		kind: 'site',
		id: 'geo/agents-md',
		name: 'AGENTS.md',
		domain: 'geo',
		defaultSeverity: 'warning',
		description: 'Project should have an AGENTS.md file with page summaries',
		essential: true,
		async run(ctx: SiteCheckContext): Promise<SiteCheckIssue[]> {
			const agentsPath = path.join(ctx.projectRoot, 'AGENTS.md')
			let content: string
			try {
				content = await fs.readFile(agentsPath, 'utf-8')
			} catch {
				return [{
					message: 'Project is missing an AGENTS.md file',
					suggestion: 'Add an AGENTS.md file to make your site discoverable by AI agents',
					pagePath: '/AGENTS.md',
				}]
			}

			if (!content.includes('<page_summary>')) {
				return [{
					message: 'AGENTS.md does not contain any <page_summary> markers',
					suggestion: 'Use @nuasite/agent-summary to generate page summaries in AGENTS.md',
					pagePath: '/AGENTS.md',
				}]
			}
			return []
		},
	}
}
