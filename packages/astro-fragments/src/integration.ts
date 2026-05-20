import type { AstroIntegration, AstroIntegrationLogger } from 'astro'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { mapWithConcurrency } from './concurrency.ts'
import { buildManifest, type FragmentManifest, type FragmentManifestEntry } from './manifest.ts'
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
	const fragmentsOutDir = path.resolve(distDir, outputDir)
	const manifestPath = path.join(fragmentsOutDir, manifestName)

	// A prior manifest persists across incremental rebuilds (the host —
	// e.g. pletivo — is expected to restore both manifest.json and the
	// referenced fragment files into dist/ before this hook runs). Under a
	// stock Astro build that wipes dist/, there is no prior manifest and
	// behavior collapses to the strict "registry is the source of truth"
	// path.
	//
	// If the user changed `outputDir` between builds the prior manifest's
	// `file` pointers reference the old directory; treat it as absent so
	// we don't emit a new manifest whose entries point at non-existent
	// files. The host should clean dist/ in that case anyway.
	const rawExistingManifest = await readExistingManifest(manifestPath)
	const existingManifest = rawExistingManifest && rawExistingManifest.outputDir === outputDir
		? rawExistingManifest
		: null
	if (rawExistingManifest && !existingManifest) {
		logger.info(`prior manifest's outputDir (${rawExistingManifest.outputDir}) differs from configured "${outputDir}"; ignoring it`)
	}

	const usedByMap = new Map<string, Set<string>>()
	for (const ph of placeholders) {
		let set = usedByMap.get(ph.id)
		if (!set) {
			set = new Set()
			usedByMap.set(ph.id, set)
		}
		set.add(ph.pageFile)
	}

	const registeredIds = new Set(fragments.map(f => f.hash))

	// Split registered fragments into ones we have to render this build
	// vs ones a host replayed without a factory whose previously-rendered
	// HTML is still on disk — those we reuse byte-for-byte rather than
	// paying for a lazy import + render.
	const toRender: FragmentEntry[] = []
	const lazyReuseFragments: FragmentEntry[] = []
	for (const fragment of fragments) {
		if (fragment.component) {
			toRender.push(fragment)
			continue
		}
		const filePath = path.join(fragmentsOutDir, `${fragment.hash}.html`)
		try {
			await fs.access(filePath)
			lazyReuseFragments.push(fragment)
		} catch {
			toRender.push(fragment)
		}
	}

	const reusedIds = await pickReusableManifestIds(existingManifest, registeredIds, distDir)
	validateAcceptable(placeholders, registeredIds, reusedIds)

	if (registeredIds.size === 0 && reusedIds.size === 0) {
		logger.info('no fragments registered, skipping output')
		return
	}

	await fs.mkdir(fragmentsOutDir, { recursive: true })

	const projectRoot = getProjectRoot()

	let containerPromise:
		| Promise<{ renderToString: (c: AstroComponentFactory, opts: { props: Record<string, unknown> }) => Promise<string> }>
		| undefined
	function getContainer() {
		if (!containerPromise) {
			containerPromise = (async () => {
				const { experimental_AstroContainer: AstroContainer } = await import('astro/container')
				return await AstroContainer.create()
			})()
		}
		return containerPromise
	}

	const componentCache = new Map<string, Promise<AstroComponentFactory>>()
	async function resolveComponent(fragment: FragmentEntry): Promise<AstroComponentFactory> {
		if (fragment.component) return fragment.component
		const moduleId = fragment.moduleId
		let cached = componentCache.get(moduleId)
		if (!cached) {
			cached = (async () => {
				const absPath = projectRoot && !path.isAbsolute(moduleId)
					? path.resolve(projectRoot, moduleId)
					: moduleId
				let mod: Record<string, unknown>
				try {
					mod = await import(pathToFileURL(absPath).href)
				} catch (e) {
					throw new Error(
						`Failed to lazy-import fragment component "${moduleId}" from ${absPath}. `
							+ `The integration tried to resolve the component on demand because no factory was registered for fragment `
							+ `(this happens when a host like pletivo replays cached fragment registrations on an incremental rebuild). `
							+ `Make sure the host runtime supports importing .astro modules. Original error: ${(e as Error).message}`,
						{ cause: e },
					)
				}
				const comp = mod.default
				if (typeof comp !== 'function') {
					throw new Error(
						`Default export of "${moduleId}" is not a component factory (got ${typeof comp}).`,
					)
				}
				return comp as AstroComponentFactory
			})()
			componentCache.set(moduleId, cached)
		}
		return cached
	}

	function relativizeModuleId(moduleId: string): string {
		return projectRoot && moduleId.startsWith(projectRoot)
			? moduleId.slice(projectRoot.length).replace(/^\/+/, '')
			: moduleId
	}

	const start = Date.now()
	const renderResults = await mapWithConcurrency(toRender, concurrency, async fragment => {
		const comp = await resolveComponent(fragment)
		let html: string
		try {
			const container = await getContainer()
			html = await container.renderToString(comp, { props: fragment.props })
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			throw new Error(`Failed to render fragment ${fragment.hash} (${fragment.moduleId}): ${msg}`, { cause: e })
		}
		const filePath = path.join(fragmentsOutDir, `${fragment.hash}.html`)
		await fs.writeFile(filePath, html, 'utf8')
		return {
			hash: fragment.hash,
			moduleId: relativizeModuleId(fragment.moduleId),
			props: fragment.props,
			usedBy: [...(usedByMap.get(fragment.hash) ?? fragment.usedBy)],
			size: Buffer.byteLength(html, 'utf8'),
		}
	})

	type ResultEntry = {
		hash: string
		moduleId: string
		props: Record<string, unknown>
		usedBy: string[]
		size: number
	}

	// Lazy replayed fragments whose HTML is on disk: keep the bytes,
	// recover `size` by stat (prior manifest may not exist if the user
	// only restored fragment files, not the manifest itself).
	const lazyReuseResults: ResultEntry[] = []
	for (const fragment of lazyReuseFragments) {
		const filePath = path.join(fragmentsOutDir, `${fragment.hash}.html`)
		const stat = await fs.stat(filePath)
		lazyReuseResults.push({
			hash: fragment.hash,
			moduleId: relativizeModuleId(fragment.moduleId),
			props: fragment.props,
			usedBy: [...(usedByMap.get(fragment.hash) ?? fragment.usedBy)],
			size: stat.size,
		})
	}

	// Manifest-only reuse: fragments the registry doesn't know about
	// this build (host skipped the page entirely) but whose entries +
	// files survived from the prior manifest.
	const manifestReuseResults: ResultEntry[] = []
	if (existingManifest) {
		for (const id of reusedIds) {
			const prior = existingManifest.fragments[id]
			if (!prior) continue
			const usedBy = usedByMap.get(id)
			manifestReuseResults.push({
				hash: id,
				moduleId: prior.moduleId,
				props: prior.props,
				usedBy: usedBy ? [...usedBy] : [...prior.usedBy],
				size: prior.size,
			})
		}
	}

	const allResults = [...renderResults, ...lazyReuseResults, ...manifestReuseResults]
	const manifest = buildManifest({ outputDir, entries: allResults })
	await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

	const elapsed = Date.now() - start
	const reusedCount = lazyReuseResults.length + manifestReuseResults.length
	const reusedMsg = reusedCount > 0 ? `, reused ${reusedCount}` : ''
	logger.info(`rendered ${renderResults.length} fragment(s)${reusedMsg} into ${outputDir}/ in ${elapsed}ms`)
}

export async function readExistingManifest(manifestPath: string): Promise<FragmentManifest | null> {
	try {
		const raw = await fs.readFile(manifestPath, 'utf8')
		const parsed = JSON.parse(raw) as unknown
		if (typeof parsed !== 'object' || parsed === null) return null
		const obj = parsed as Record<string, unknown>
		if (obj.version !== 1) return null
		if (typeof obj.outputDir !== 'string') return null
		const fragments = obj.fragments
		if (typeof fragments !== 'object' || fragments === null) return null
		for (const [id, entry] of Object.entries(fragments as Record<string, unknown>)) {
			if (typeof entry !== 'object' || entry === null) return null
			const e = entry as Record<string, unknown>
			if (typeof e.id !== 'string' || e.id !== id) return null
			if (typeof e.file !== 'string') return null
			if (typeof e.moduleId !== 'string') return null
			if (typeof e.props !== 'object' || e.props === null) return null
			if (!Array.isArray(e.usedBy)) return null
			if (typeof e.size !== 'number') return null
		}
		return parsed as FragmentManifest
	} catch {
		return null
	}
}

/**
 * For each fragment entry in `existingManifest` that is NOT being
 * re-rendered this build (i.e. not in `registeredIds`), keep it only if
 * its file is still on disk under `distDir`. Returns the set of reusable
 * ids — the host's cached HTML may reference these via `<x-fragment id>`
 * placeholders even though the registry doesn't know about them this
 * pass.
 */
export async function pickReusableManifestIds(
	existingManifest: FragmentManifest | null,
	registeredIds: Set<string>,
	distDir: string,
): Promise<Set<string>> {
	const reusable = new Set<string>()
	if (!existingManifest) return reusable
	for (const [id, entry] of Object.entries(existingManifest.fragments)) {
		if (registeredIds.has(id)) continue
		const filePath = path.join(distDir, entry.file)
		try {
			await fs.access(filePath)
			reusable.add(id)
		} catch {
			// Manifest pointer is stale (file evicted) — fall through;
			// the strict check below will surface it if anything still
			// references it.
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

// Re-export so callers can dispatch on the entry shape if they need to.
export type { FragmentManifestEntry }
