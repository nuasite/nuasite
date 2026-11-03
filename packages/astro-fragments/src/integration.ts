import type { AstroIntegration, AstroIntegrationLogger } from 'astro'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { mapWithConcurrency } from './concurrency.ts'
import { buildManifest, type BuildManifestParams, type FragmentManifest, readExistingManifest } from './manifest.ts'
import { type AstroComponentFactory, disableRegistry, enableRegistry, type FragmentEntry, getFragments, getProjectRoot } from './registry.ts'
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
	 * Concurrency for fragment rendering and for scanning the built pages.
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

type ResultEntry = BuildManifestParams['entries'][number]

async function renderFragments({ distDir, outputDir, manifestName, concurrency, logger }: RenderParams): Promise<void> {
	const fragments = getFragments()
	const placeholders = await scanDistForPlaceholders(distDir, outputDir, concurrency)
	const fragmentsOutDir = path.resolve(distDir, outputDir)
	const manifestPath = path.join(fragmentsOutDir, manifestName)

	// An incremental host keeps dist/ between builds, so a previous manifest can
	// describe fragments of pages the host did not render this time. A clean
	// `astro build` has none. A manifest written for another outputDir points at
	// files that are not there, so it is ignored.
	const rawExistingManifest = await readExistingManifest(manifestPath)
	const existingManifest = rawExistingManifest && rawExistingManifest.outputDir === outputDir ? rawExistingManifest : null
	if (rawExistingManifest && !existingManifest) {
		logger.info(`prior manifest's outputDir (${rawExistingManifest.outputDir}) differs from configured "${outputDir}"; ignoring it`)
	}

	// The scan covers every page in dist/, so it alone decides which pages use a fragment.
	const usedByMap = new Map<string, Set<string>>()
	for (const ph of placeholders) {
		let set = usedByMap.get(ph.id)
		if (!set) {
			set = new Set()
			usedByMap.set(ph.id, set)
		}
		set.add(ph.pageFile)
	}
	const usedBy = (id: string): string[] => [...(usedByMap.get(id) ?? [])]

	const registeredIds = new Set(fragments.map(f => f.hash))
	const reusedIds = await pickReusableManifestIds(existingManifest, registeredIds, new Set(usedByMap.keys()), distDir)
	validateAcceptable(placeholders, registeredIds, reusedIds)

	if (registeredIds.size === 0 && reusedIds.size === 0) {
		await removeOrphanFiles(fragmentsOutDir, new Set())
		await fs.rm(manifestPath, { force: true })
		logger.info('no fragments registered, skipping output')
		return
	}

	await fs.mkdir(fragmentsOutDir, { recursive: true })

	const projectRoot = getProjectRoot()

	let containerPromise: ReturnType<typeof createContainer> | undefined
	const componentCache = new Map<string, Promise<AstroComponentFactory>>()
	function resolveComponent(fragment: FragmentEntry): Promise<AstroComponentFactory> {
		if (fragment.component) return Promise.resolve(fragment.component)
		let cached = componentCache.get(fragment.moduleId)
		if (!cached) {
			cached = importComponent(fragment.moduleId, projectRoot)
			componentCache.set(fragment.moduleId, cached)
		}
		return cached
	}

	const start = Date.now()
	// Every registered fragment is rendered, including ones a host replayed from
	// its cache: the fragment's data reads happen here, outside the page render the
	// host tracked, so a file left from an earlier build may be out of date.
	const renderResults = await mapWithConcurrency(fragments, concurrency, async (fragment): Promise<ResultEntry> => {
		const comp = await resolveComponent(fragment)
		let html: string
		try {
			containerPromise ??= createContainer()
			const container = await containerPromise
			html = await container.renderToString(comp, { props: fragment.props })
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			throw new Error(`Failed to render fragment ${fragment.hash} (${fragment.moduleId}): ${msg}`, { cause: e })
		}
		await fs.writeFile(path.join(fragmentsOutDir, `${fragment.hash}.html`), html, 'utf8')
		return {
			hash: fragment.hash,
			moduleId: fragment.moduleId,
			props: fragment.props,
			usedBy: usedBy(fragment.hash),
			size: Buffer.byteLength(html, 'utf8'),
		}
	})

	// Fragments no page registered this build, kept because a page the host did
	// not render still references them and their file is still on disk.
	const manifestReuseResults: ResultEntry[] = []
	for (const id of reusedIds) {
		const prior = existingManifest?.fragments[id]
		if (!prior) continue
		manifestReuseResults.push({ hash: id, moduleId: prior.moduleId, props: prior.props, usedBy: usedBy(id), size: prior.size })
	}

	const allResults = [...renderResults, ...manifestReuseResults]
	await removeOrphanFiles(fragmentsOutDir, new Set(allResults.map(r => r.hash)))
	const manifest = buildManifest({ outputDir, entries: allResults })
	await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

	const elapsed = Date.now() - start
	const reusedMsg = manifestReuseResults.length > 0 ? `, reused ${manifestReuseResults.length}` : ''
	logger.info(`rendered ${renderResults.length} fragment(s)${reusedMsg} into ${outputDir}/ in ${elapsed}ms`)
}

async function createContainer() {
	const { experimental_AstroContainer: AstroContainer } = await import('astro/container')
	return await AstroContainer.create()
}

async function importComponent(moduleId: string, projectRoot: string | null): Promise<AstroComponentFactory> {
	const absPath = projectRoot ? path.resolve(projectRoot, moduleId) : moduleId
	let mod: { default?: unknown }
	try {
		mod = await import(pathToFileURL(absPath).href)
	} catch (e) {
		throw new Error(
			`Failed to import fragment component "${moduleId}" from ${absPath}. `
				+ `It was registered without a component factory (an incremental host replaying a cached page), `
				+ `so the host runtime has to be able to import .astro modules. Original error: ${e instanceof Error ? e.message : String(e)}`,
			{ cause: e },
		)
	}
	if (!isComponentFactory(mod.default)) {
		throw new Error(`Default export of "${moduleId}" is not a component factory (got ${typeof mod.default}).`)
	}
	return mod.default
}

function isComponentFactory(value: unknown): value is AstroComponentFactory {
	return typeof value === 'function'
}

const FRAGMENT_FILE = /^[a-f0-9]{12}\.html$/

/** Deletes fragment files from earlier builds that no page references any more. */
async function removeOrphanFiles(fragmentsOutDir: string, keep: Set<string>): Promise<void> {
	let names: string[]
	try {
		names = await fs.readdir(fragmentsOutDir)
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
		throw error
	}
	await Promise.all(
		names
			.filter(name => FRAGMENT_FILE.test(name) && !keep.has(name.slice(0, -'.html'.length)))
			.map(name => fs.rm(path.join(fragmentsOutDir, name), { force: true })),
	)
}

/**
 * Picks the entries of the previous manifest that this build keeps without
 * rendering them: not registered again, still referenced by a placeholder in
 * dist/, and with their file still on disk.
 */
export async function pickReusableManifestIds(
	existingManifest: FragmentManifest | null,
	registeredIds: Set<string>,
	referencedIds: Set<string>,
	distDir: string,
): Promise<Set<string>> {
	const reusable = new Set<string>()
	if (!existingManifest) return reusable
	for (const [id, entry] of Object.entries(existingManifest.fragments)) {
		if (registeredIds.has(id) || !referencedIds.has(id)) continue
		try {
			await fs.access(path.join(distDir, entry.file))
			reusable.add(id)
		} catch {
			// The file is gone; validateAcceptable reports any placeholder still pointing at it.
		}
	}
	return reusable
}

/**
 * Ensure every `<x-fragment id>` placeholder found in dist/ corresponds
 * either to a freshly-registered fragment or to one we are reusing from
 * the previous manifest. A placeholder with no matching id signals a
 * dangling reference (deleted fragment, stale dist/, hand-written
 * placeholder) — surface it loudly instead of silently skipping.
 */
export function validateAcceptable(
	placeholders: Array<{ id: string; pageFile: string }>,
	registeredIds: Set<string>,
	reusedIds: Set<string>,
): void {
	const acceptable = new Set<string>(registeredIds)
	for (const id of reusedIds) acceptable.add(id)
	for (const ph of placeholders) {
		if (!acceptable.has(ph.id)) {
			throw new Error(
				`Found <x-fragment id="${ph.id}"> in ${ph.pageFile}, but no fragment with this id was registered or cached. This indicates a stale dist/ directory or a manually-written placeholder. Run a clean build.`,
			)
		}
	}
}
