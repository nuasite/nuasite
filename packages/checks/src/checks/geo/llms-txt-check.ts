import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { CheckResult, SiteCheck, SiteCheckContext } from '../../types'

export function createLlmsTxtCheck(): SiteCheck {
	return {
		kind: 'site',
		id: 'geo/llms-txt',
		name: 'llms.txt',
		domain: 'geo',
		defaultSeverity: 'warning',
		description: 'Site should have a valid llms.txt file',
		essential: true,
		run(ctx: SiteCheckContext): CheckResult[] {
			const llmsPath = path.join(ctx.distDir, 'llms.txt')
			let content: string | undefined
			try {
				content = readFileSync(llmsPath, 'utf-8')
			} catch {
				return [{
					checkId: 'geo/llms-txt',
					ruleName: 'llms.txt',
					domain: 'geo',
					severity: 'warning',
					message: 'Site is missing a llms.txt file',
					suggestion: 'Add a llms.txt file to make your site discoverable by LLMs',
					pagePath: '/llms.txt',
				}]
			}

			if (content.trim().length === 0) {
				return [{
					checkId: 'geo/llms-txt',
					ruleName: 'llms.txt',
					domain: 'geo',
					severity: 'error',
					message: 'llms.txt file is empty',
					suggestion: 'Add content to llms.txt describing your site for LLM consumption',
					pagePath: '/llms.txt',
				}]
			}
			return []
		},
	}
}
