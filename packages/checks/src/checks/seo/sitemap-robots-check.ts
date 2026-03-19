import { existsSync } from 'node:fs'
import path from 'node:path'
import type { CheckResult, SiteCheck, SiteCheckContext } from '../../types'

export function createRobotsTxtCheck(): SiteCheck {
	return {
		kind: 'site',
		id: 'seo/robots-txt',
		name: 'robots.txt Present',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Site should have a robots.txt file',
		essential: false,
		run(ctx: SiteCheckContext): CheckResult[] {
			if (!existsSync(path.join(ctx.distDir, 'robots.txt'))) {
				return [{
					checkId: 'seo/robots-txt',
					ruleName: 'robots.txt Present',
					domain: 'seo',
					severity: 'warning',
					message: 'Site is missing a robots.txt file',
					suggestion: 'Add a robots.txt file to the public directory or use an Astro integration to generate one',
					pagePath: '/robots.txt',
				}]
			}
			return []
		},
	}
}

export function createSitemapXmlCheck(): SiteCheck {
	return {
		kind: 'site',
		id: 'seo/sitemap-xml',
		name: 'Sitemap Present',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Site should have a sitemap',
		essential: false,
		run(ctx: SiteCheckContext): CheckResult[] {
			const hasSitemapIndex = existsSync(path.join(ctx.distDir, 'sitemap-index.xml'))
			const hasSitemap0 = existsSync(path.join(ctx.distDir, 'sitemap-0.xml'))
			if (!hasSitemapIndex && !hasSitemap0) {
				return [{
					checkId: 'seo/sitemap-xml',
					ruleName: 'Sitemap Present',
					domain: 'seo',
					severity: 'warning',
					message: 'Site is missing a sitemap',
					suggestion: 'Add @astrojs/sitemap to generate a sitemap automatically',
					pagePath: '/sitemap-index.xml',
				}]
			}
			return []
		},
	}
}
