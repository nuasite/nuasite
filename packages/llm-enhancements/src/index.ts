import type { AstroConfig, AstroIntegration } from 'astro'
import { processBuildOutput } from './build-processor'
import { createDevMiddleware } from './dev-middleware'
import { type PageMarkdownOptions, resolveOptions } from './types'

export default function pageMarkdown(options: PageMarkdownOptions = {}): AstroIntegration {
	const resolvedOptions = resolveOptions(options)
	let config: AstroConfig

	return {
		name: '@nuasite/llm-enhancements',
		hooks: {
			'astro:config:done': ({ config: cfg }) => {
				config = cfg
			},

			'astro:server:setup': ({ server, logger }) => {
				// Cast needed due to Astro's bundled Vite types differing from root vite
				createDevMiddleware(server as unknown as Parameters<typeof createDevMiddleware>[0], resolvedOptions, config)
				logger.info('Markdown endpoints enabled')
			},

			'astro:build:done': async ({ dir, pages, logger }) => {
				await processBuildOutput(dir, pages, resolvedOptions, logger, config)
			},
		},
	}
}

export type { LlmEndpointOptions, LlmsTxtOptions, MarkdownOutput, PageMarkdownOptions } from './types'
