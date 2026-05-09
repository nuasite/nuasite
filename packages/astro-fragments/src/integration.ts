import type { AstroIntegration, AstroIntegrationLogger } from 'astro'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { mapWithConcurrency } from './concurrency.ts'
import { buildManifest } from './manifest.ts'
import { disableRegistry, enableRegistry, getFragments, getProjectRoot } from './registry.ts'
import { scanDistForPlaceholders } from './scan.ts'

export interface AstroFragmentsOptions {
	/**
	 * Subdirectory inside the build output where fragment HTML snippets are written.
	 * Default: '_fragments'
	 */
	outputDir?: string
	/**
	 * Manifest filename (placed inside outputDir).
	 * Default: 'manifest.json'
	 */
	manifestName?: string
	/**
	 * Concurrency for fragment rendering.
	 * Default: 8
	 */
	concurrency?: number
}

export default function astroFragments(options: AstroFragmentsOptions = {}): AstroIntegration {
	const outputDir = options.outputDir ?? '_fragments'
	const manifestName = options.manifestName ?? 'manifest.json'
	const concurrency = options.concurrency ?? 8

	let projectRoot: string | null = null

	return {
		name: '@nuasite/astro-fragments',
		hooks: {
			'astro:config:setup': ({ config, command, logger }) => {
				if (config.output && config.output !== 'static') {
					throw new Error(
						`@nuasite/astro-fragments requires output: "static". Got "${config.output}". This plugin emits build-time HTML snippets and is incompatible with SSR/server output.`,
					)
				}
				projectRoot = fileURLToPath(config.root)
				if (command === 'build') {
					enableRegistry(projectRoot)
					logger.info(`fragments registry enabled at ${projectRoot}`)
				}
			},
			'astro:build:start': () => {
				if (projectRoot) enableRegistry(projectRoot)
			},
			'astro:build:done': async ({ dir, logger }) => {
				const distDir = fileURLToPath(dir)
				try {
					await renderFragments({ distDir, outputDir, manifestName, concurrency, logger })
				} finally {
					disableRegistry()
				}
			},
		},
	}
}

interface RenderParams {
	distDir: string
	outputDir: string
	manifestName: string
	concurrency: number
	logger: AstroIntegrationLogger
}

async function renderFragments({ distDir, outputDir, manifestName, concurrency, logger }: RenderParams): Promise<void> {
	const fragments = getFragments()
	const placeholders = await scanDistForPlaceholders(distDir, outputDir)

	const usedByMap = new Map<string, Set<string>>()
	for (const ph of placeholders) {
		let set = usedByMap.get(ph.id)
		if (!set) {
			set = new Set()
			usedByMap.set(ph.id, set)
		}
		set.add(ph.pageFile)
	}

	const seenIds = new Set(fragments.map(f => f.hash))
	for (const ph of placeholders) {
		if (!seenIds.has(ph.id)) {
			throw new Error(
				`Found <x-fragment id="${ph.id}"> in ${ph.pageFile}, but no fragment with this id was registered. This indicates a stale dist/ directory or a manually-written placeholder. Run a clean build.`,
			)
		}
	}

	if (fragments.length === 0) {
		logger.info('no fragments registered, skipping output')
		return
	}

	const fragmentsOutDir = path.resolve(distDir, outputDir)
	await fs.mkdir(fragmentsOutDir, { recursive: true })

	const { experimental_AstroContainer: AstroContainer } = await import('astro/container')
	const container = await AstroContainer.create()

	const projectRoot = getProjectRoot()
	const start = Date.now()
	const results = await mapWithConcurrency(fragments, concurrency, async fragment => {
		let html: string
		try {
			html = await container.renderToString(fragment.component, { props: fragment.props })
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			throw new Error(`Failed to render fragment ${fragment.hash} (${fragment.moduleId}): ${msg}`, { cause: e })
		}
		const filePath = path.join(fragmentsOutDir, `${fragment.hash}.html`)
		await fs.writeFile(filePath, html, 'utf8')
		const relativeModuleId = projectRoot && fragment.moduleId.startsWith(projectRoot)
			? fragment.moduleId.slice(projectRoot.length).replace(/^\/+/, '')
			: fragment.moduleId
		return {
			hash: fragment.hash,
			moduleId: relativeModuleId,
			props: fragment.props,
			usedBy: [...(usedByMap.get(fragment.hash) ?? fragment.usedBy)],
			size: Buffer.byteLength(html, 'utf8'),
		}
	})

	const manifest = buildManifest({ outputDir, entries: results })
	const manifestPath = path.join(fragmentsOutDir, manifestName)
	await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

	const elapsed = Date.now() - start
	logger.info(`rendered ${results.length} fragment(s) into ${outputDir}/ in ${elapsed}ms`)
}
