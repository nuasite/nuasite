import fs from 'node:fs/promises'
import path from 'node:path'
import type { SiteCheck, SiteCheckContext, SiteCheckIssue } from '../../types'

export function createLlmsTxtCheck(): SiteCheck {
	return {
		kind: 'site',
		id: 'geo/llms-txt',
		name: 'llms.txt',
		domain: 'geo',
		defaultSeverity: 'warning',
		description: 'Site should have a valid llms.txt file',
		essential: true,
		async run(ctx: SiteCheckContext): Promise<SiteCheckIssue[]> {
			const llmsPath = path.join(ctx.distDir, 'llms.txt')
			let content: string
			try {
				content = await fs.readFile(llmsPath, 'utf-8')
			} catch {
				return [{
					message: 'Site is missing a llms.txt file',
					suggestion: 'Add a llms.txt file to make your site discoverable by LLMs',
					pagePath: '/llms.txt',
				}]
			}

			if (content.trim().length === 0) {
				return [{
					message: 'llms.txt file is empty',
					suggestion: 'Add content to llms.txt describing your site for LLM consumption',
					pagePath: '/llms.txt',
				}]
			}
			return []
		},
	}
}
