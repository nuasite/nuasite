import type { AstroIntegration } from 'astro'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { PageMeta, RedirectMeta } from './types.ts'
import { extractMetaFromHtml, formatDestination, normalizeRoute, resolveHtmlPath, updateAgentsSummary } from './utils.ts'

export const agentsSummary = (): AstroIntegration => {
	const redirectPathnames = new Set<string>()
	const redirects: RedirectMeta[] = []
	// Next to the site's sources, which need not be the working directory (`astro build --root site`).
	let agentsPath: string | undefined

	return {
		name: 'agents-summary',
		hooks: {
			'astro:config:done': ({ config }) => {
				agentsPath = fileURLToPath(new URL('AGENTS.md', config.root))
			},
			'astro:routes:resolved': ({ routes }) => {
				redirectPathnames.clear()
				redirects.length = 0
				for (const route of routes) {
					if (route.type === 'redirect' && route.pathname) {
						const from = normalizeRoute(route.pathname)
						redirectPathnames.add(from)

						let destination = ''
						let status = ''
						const redirectConfig = route.redirect
						if (typeof redirectConfig === 'string') {
							destination = redirectConfig
							status = '302'
						} else if (redirectConfig) {
							destination = redirectConfig.destination
							status = redirectConfig.status?.toString() ?? ''
						} else if (route.redirectRoute?.pathname) {
							destination = route.redirectRoute.pathname
						}

						let resolvedDestination = destination
						if (!resolvedDestination && route.redirectRoute?.pattern) {
							resolvedDestination = route.redirectRoute.pattern.toString()
						}

						const to = resolvedDestination?.startsWith('^')
							? resolvedDestination
							: formatDestination(resolvedDestination)

						redirects.push({
							from,
							to,
							status: status || '302',
						})
					}
				}
			},
			'astro:build:done': async ({ dir, pages, logger }) => {
				const distDir = fileURLToPath(dir)
				const summaries: PageMeta[] = []

				for (const page of pages) {
					const route = normalizeRoute(page.pathname)
					if (redirectPathnames.has(route)) {
						continue
					}

					const htmlPath = await resolveHtmlPath(distDir, page.pathname)
					if (!htmlPath) {
						logger.warn(`Skipping ${page.pathname}; no HTML output found.`)
						continue
					}

					const html = await fs.readFile(htmlPath, 'utf8')
					summaries.push(extractMetaFromHtml(page.pathname, html))
				}

				if (summaries.length === 0) {
					logger.warn('No pages detected; AGENTS.md was not updated.')
					return
				}

				if (agentsPath === undefined) throw new Error('agents-summary: astro:build:done ran before astro:config:done')
				await updateAgentsSummary(agentsPath, summaries, redirects)
				logger.info(`Updated AGENTS.md with ${summaries.length} page entries${redirects.length > 0 ? ` and ${redirects.length} redirects` : ''}.`)
			},
		},
	}
}
