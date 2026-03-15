import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import cms from '@nuasite/cms'
import tailwindcss from '@tailwindcss/vite'
import type { AstroIntegration } from 'astro'
import { writeFile } from 'node:fs/promises'
import pageMarkdown from '../../llm-enhancements/src'
import { type NuaIntegrationOptions, resolveOptions } from './types'

interface NormalizedRedirect {
	from: string
	to: string
	code: number
}

export default function nua(options: NuaIntegrationOptions = {}): AstroIntegration {
	const resolved = resolveOptions(options)
	let capturedRedirects: NormalizedRedirect[] = []

	return {
		name: '@nuasite/nua',
		hooks: {
			'astro:config:setup': ({ config, updateConfig, command, injectScript, logger }) => {
				const integrations: AstroIntegration[] = []
				const vitePlugins = []

				// Add Tailwind CSS Vite plugin
				if (resolved.tailwindcss) {
					vitePlugins.push(...tailwindcss())
					logger.info('Tailwind CSS enabled')
				}

				// Add nuasite integrations
				if (resolved.cms !== false) {
					integrations.push(cms(resolved.cms))
					logger.info('CMS enabled')
				}

				if (resolved.pageMarkdown !== false) {
					integrations.push(pageMarkdown(resolved.pageMarkdown))
					logger.info('Page Markdown enabled')
				}

				// Add official Astro integrations
				if (resolved.mdx !== false) {
					integrations.push(mdx(resolved.mdx))
					logger.info('MDX enabled')
				}

				if (resolved.sitemap !== false) {
					integrations.push(sitemap(resolved.sitemap))
					logger.info('Sitemap enabled')
				}

				// Hide Astro's dev toolbar in dev mode.
				// We cannot set devToolbar.enabled = false because Astro ties
				// source file annotations (data-astro-source-file) to that flag,
				// and the CMS needs those annotations to map elements to source files.
				if (command === 'dev') {
					injectScript(
						'page',
						`
						const tb = document.querySelector('astro-dev-toolbar');
						if (tb) tb.style.display = 'none';
						else {
							const o = new MutationObserver((_, obs) => {
								const el = document.querySelector('astro-dev-toolbar');
								if (el) { el.style.display = 'none'; obs.disconnect(); }
							});
							o.observe(document.documentElement, { childList: true, subtree: true });
						}
					`,
					)
				}

				// Capture and strip Astro redirects to generate _redirects file instead of meta-refresh HTML
				const astroRedirects = config.redirects ?? {}
				capturedRedirects = Object.entries(astroRedirects).map(([from, value]) => {
					const destination = typeof value === 'string' ? value : value.destination
					const code = typeof value === 'string' ? 301 : (value.status ?? 301)
					const normalizedFrom = from.replace(/\[\.\.\.[\w]+\]/g, '*')
					const normalizedTo = destination.replace(/\[\.\.\.[\w]+\]/g, ':splat')
					return { from: normalizedFrom, to: normalizedTo, code }
				})

				// Inject Vite plugins and integrations
				updateConfig({
					redirects: {},
					vite: {
						plugins: vitePlugins,
					},
					integrations,
				})
			},
			'astro:build:done': async ({ dir, logger }) => {
				if (capturedRedirects.length === 0) return
				const lines = capturedRedirects.map(r => `${r.from} ${r.to} ${r.code}`)
				const content = lines.join('\n') + '\n'
				const filePath = new URL('_redirects', dir)
				await writeFile(filePath, content, 'utf-8')
				logger.info(`Generated _redirects with ${capturedRedirects.length} rules`)
			},
		},
	}
}
