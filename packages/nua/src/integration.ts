import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import checks from '@nuasite/checks'
import cms, { cmsRemarkPlugins, mergeConfigRedirectsInto } from '@nuasite/cms'
import tailwindcss from '@tailwindcss/vite'
import type { AstroConfig, AstroIntegration } from 'astro'
import pageMarkdown from '../../llm-enhancements/src'
import { type NuaIntegrationOptions, resolveOptions } from './types'

export default function nua(options: NuaIntegrationOptions = {}): AstroIntegration {
	const resolved = resolveOptions(options)
	let capturedRedirects: AstroConfig['redirects'] = {}

	return {
		name: '@nuasite/nua',
		hooks: {
			'astro:config:setup': ({ config, updateConfig, command, injectScript, logger }) => {
				const integrations: AstroIntegration[] = []

				// Tailwind is required — the CMS color/text-style system
				// expects the host site to compile Tailwind utility classes.
				const vitePlugins = [...tailwindcss()]

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

				// Checks must be last — it validates output from all other integrations
				if (resolved.checks !== false) {
					integrations.push(checks(resolved.checks))
					logger.info('Checks enabled')
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

				// Captured for `_redirects`. The `redirects: {}` passed to `updateConfig` below does not clear
				// them: Astro deep-merges config updates, so it still renders its own meta-refresh pages.
				capturedRedirects = config.redirects ?? {}

				// Inject Vite plugins and integrations.
				// CMS list-style directives (`:::list{.class}`) need `remark-directive`
				// in the markdown pipeline — both to render `<ul class="class">` and to
				// stop MDX from parsing the `{.class}` attributes as a JS expression
				// (which crashes acorn). `@astrojs/mdx` inherits these via
				// `extendMarkdownConfig` (default true).
				updateConfig({
					redirects: {},
					markdown: {
						remarkPlugins: cmsRemarkPlugins,
					},
					vite: {
						plugins: vitePlugins,
						ssr: {
							// Without this, dev-mode SSR externalizes the package and its
							// TS barrel is loaded by the runtime instead of Vite. Under Bun
							// (the nua CLI runtime) the nested `.astro` imports then resolve
							// to file-path strings via Bun's file loader, and Astro renders
							// the components as literal path-named tags — `<Form>` loses its
							// `<form>` wrapper and submits silently do nothing.
							noExternal: ['@nuasite/components'],
						},
					},
					integrations,
				})
			},
			'astro:build:done': async ({ dir, logger }) => {
				// Merged into the copy Astro took of `public/_redirects`, never written over it. The CMS
				// merges its own rules after this and checks the limits on the final file.
				await mergeConfigRedirectsInto(dir, logger, capturedRedirects, resolved.cms === false)
			},
		},
	}
}
