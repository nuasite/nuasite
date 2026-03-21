import fs from 'node:fs/promises'
import path from 'node:path'
import type { SiteCheck, SiteCheckContext, SiteCheckIssue } from '../../types'

export function createRobotsTxtCheck(): SiteCheck {
	return {
		kind: 'site',
		id: 'seo/robots-txt',
		name: 'robots.txt Present',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Site should have a robots.txt file',
		essential: false,
		async run(ctx: SiteCheckContext): Promise<SiteCheckIssue[]> {
			try {
				await fs.access(path.join(ctx.distDir, 'robots.txt'))
				return []
			} catch {
				return [{
					message: 'Site is missing a robots.txt file',
					suggestion: 'Add a robots.txt file to the public directory or use an Astro integration to generate one',
					pagePath: '/robots.txt',
				}]
			}
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
		async run(ctx: SiteCheckContext): Promise<SiteCheckIssue[]> {
			const files = ['sitemap-index.xml', 'sitemap-0.xml', 'sitemap.xml']
			for (const file of files) {
				try {
					await fs.access(path.join(ctx.distDir, file))
					return []
				} catch {
					// continue checking next file
				}
			}
			return [{
				message: 'Site is missing a sitemap',
				suggestion: 'Add @astrojs/sitemap to generate a sitemap automatically',
				pagePath: '/sitemap-index.xml',
			}]
		},
	}
}
