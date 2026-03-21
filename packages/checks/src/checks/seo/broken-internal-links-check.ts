import type { SiteCheck, SiteCheckContext, SiteCheckIssue } from '../../types'

export function createBrokenInternalLinksCheck(): SiteCheck {
	return {
		kind: 'site',
		id: 'seo/broken-internal-links',
		name: 'Internal Links Valid',
		domain: 'seo',
		defaultSeverity: 'warning',
		description: 'Internal links should point to existing pages',
		essential: false,
		run(ctx: SiteCheckContext): SiteCheckIssue[] {
			const knownPaths = new Set<string>()
			for (const p of ctx.pages.keys()) {
				knownPaths.add(p)
				const withSlash = p.endsWith('/') ? p : `${p}/`
				const withoutSlash = p.endsWith('/') ? p.slice(0, -1) || '/' : p
				knownPaths.add(withSlash)
				knownPaths.add(withoutSlash)
			}

			const results: SiteCheckIssue[] = []
			for (const [pagePath, pageData] of ctx.pages) {
				for (const link of pageData.links) {
					if (!link.href) continue
					if (link.href.startsWith('http://') || link.href.startsWith('https://') || link.href.startsWith('//')) continue
					if (link.href.startsWith('#') || link.href.startsWith('mailto:') || link.href.startsWith('tel:') || link.href.startsWith('javascript:')) continue

					let targetPath = link.href.split('#')[0]!.split('?')[0]!
					if (!targetPath.startsWith('/')) {
						const base = pagePath.endsWith('/') ? pagePath : pagePath.substring(0, pagePath.lastIndexOf('/') + 1)
						targetPath = base + targetPath
					}
					targetPath = targetPath.replace(/\/+/g, '/')

					if (!knownPaths.has(targetPath)) {
						results.push({
							message: `Internal link to "${link.href}" does not match any known page`,
							suggestion: 'Fix the link href or create the target page',
							pagePath,
							line: link.line,
						})
					}
				}
			}
			return results
		},
	}
}
