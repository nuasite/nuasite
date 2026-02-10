import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import cms from '@nuasite/cms'
import tailwindcss from '@tailwindcss/vite'
import type { AstroIntegration } from 'astro'
import pageMarkdown from '../../llm-enhancements/src'
import { type NuaIntegrationOptions, resolveOptions } from './types'

export default function nua(options: NuaIntegrationOptions = {}): AstroIntegration {
	const resolved = resolveOptions(options)

	return {
		name: '@nuasite/nua',
		hooks: {
			'astro:config:setup': ({ updateConfig, logger }) => {
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

				// Inject Vite plugins and integrations
				updateConfig({
					vite: {
						plugins: vitePlugins,
					},
					integrations,
				})
			},
		},
	}
}
