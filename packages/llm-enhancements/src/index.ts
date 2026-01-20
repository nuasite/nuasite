import type { AstroConfig, AstroIntegration } from 'astro'
import { processBuildOutput } from './build-processor'
import { createDevMiddleware } from './dev-middleware'
import { type PageMarkdownOptions, resolveOptions } from './types'

export default function pageMarkdown(options: PageMarkdownOptions = {}): AstroIntegration {
	const resolvedOptions = resolveOptions(options)
	let config: AstroConfig

	return {
		name: 'astro-page-markdown',
		hooks: {
			'astro:config:done': ({ config: cfg }) => {
				config = cfg
			},

			'astro:server:setup': ({ server, logger }) => {
				createDevMiddleware(server, resolvedOptions, config)
				logger.info('Markdown endpoints enabled')
			},

			'astro:build:done': async ({ dir, pages, logger }) => {
				await processBuildOutput(dir, pages, resolvedOptions, logger, config)
			},
		},
	}
}

export type { LlmEndpointOptions, LlmsTxtOptions, MarkdownOutput, PageMarkdownOptions } from './types'
