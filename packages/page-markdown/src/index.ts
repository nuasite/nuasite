import type { AstroIntegration } from 'astro'
import { processBuildOutput } from './build-processor'
import { createDevMiddleware } from './dev-middleware'
import { type PageMarkdownOptions, resolveOptions } from './types'

export default function pageMarkdown(options: PageMarkdownOptions = {}): AstroIntegration {
	const resolvedOptions = resolveOptions(options)

	return {
		name: 'astro-page-markdown',
		hooks: {
			'astro:server:setup': ({ server, logger }) => {
				createDevMiddleware(server, resolvedOptions)
				logger.info('Markdown endpoints enabled')
			},

			'astro:build:done': async ({ dir, pages, logger }) => {
				await processBuildOutput(dir, pages, resolvedOptions, logger)
			},
		},
	}
}

export type { MarkdownOutput, PageMarkdownOptions } from './types'
