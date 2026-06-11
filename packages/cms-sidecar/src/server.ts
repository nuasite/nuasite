import type { CmsCore, CmsFileSystem } from '@nuasite/cms-core'
import type { CollectionDefinition, CollectionEntry, CollectionEntryInfo, ComponentDefinition, MutationResult } from '@nuasite/cms-types'
import { hashContent, hashSource, KeyedMutex } from './concurrency'
import {
	type AddArrayItemBody,
	type ApiError,
	type Capabilities,
	type ConflictResponse,
	type CreateEntryBody,
	type CreateFolderBody,
	type EntriesListResult,
	type EntriesQuery,
	type ErrorCode,
	type PageEntry,
	type ProjectModel,
	type RemoveArrayItemBody,
	type RenameEntryBody,
	STATUS_BY_CODE,
	type UpdateEntryBody,
} from './types'

/** Features the sidecar advertises so older/newer clients can degrade gracefully. */
export const SIDECAR_FEATURES: readonly string[] = [
	'collections',
	'entries.fields-projection',
	'entries.draft-filter',
	'entries.pagination',
	'entry.crud',
	'entry.rename',
	'entry.array',
	'entry.asset',
	'entry.optimistic-concurrency',
	'pages.crud',
	'pages.list',
	'pages.layouts',
	'redirects.crud',
	'media',
	'components',
]

const API_PREFIX = '/cms/v1'
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 1000

export interface CreateServerOptions {
	core: CmsCore
	/** The same `CmsFileSystem` port the core was built over — used for hashing and the page walk. */
	fs: CmsFileSystem
	/** Resolved project root (absolute), surfaced in `/health`. */
	root: string
	/** Version reported as `coreVersion` (the cms-core package version). */
	coreVersion: string
	/** Content collections directory, relative to root. Defaults to `src/content`. */
	contentDir?: string
	/** Max accepted upload size in bytes. Defaults to 20 MiB. */
	maxUploadSize?: number
}

// ============================================================================
// Response helpers
// ============================================================================

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	})
}

function error(code: ErrorCode, message: string, sourcePath?: string): Response {
	const body: ApiError = { error: message, code }
	if (sourcePath !== undefined) body.sourcePath = sourcePath
	return json(body, STATUS_BY_CODE[code])
}

/**
 * Map a cms-core `MutationResult` to an HTTP response. A failed result becomes a
 * typed `ApiError`: "not found" → 404, everything else (validation, already
 * exists, write failures) → the supplied default code.
 */
function mutationResponse(result: MutationResult, fallback: ErrorCode = 'validation'): Response {
	if (result.success) return json(result)
	const message = result.error ?? 'Mutation failed'
	const code: ErrorCode = /not found/i.test(message) ? 'not_found' : fallback
	return error(code, message, result.sourcePath)
}

async function parseJson<T>(req: Request): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
	try {
		// `JSON.parse` returns `any`, which flows to `T` without a cast. Body shapes
		// are field-validated per route before use, never trusted blindly.
		const text = await req.text()
		const value: T = JSON.parse(text)
		return { ok: true, value }
	} catch {
		return { ok: false, response: error('validation', 'Invalid JSON body') }
	}
}

function parseEntriesQuery(url: URL): EntriesQuery {
	const fields = url.searchParams.get('fields') ?? undefined
	const rawDraft = url.searchParams.get('draft')
	const draft: EntriesQuery['draft'] = rawDraft === 'true' || rawDraft === 'all' ? rawDraft : 'false'

	const rawLimit = url.searchParams.get('limit')
	let limit: number | undefined
	if (rawLimit !== null) {
		const parsed = Number.parseInt(rawLimit, 10)
		if (Number.isFinite(parsed) && parsed > 0) limit = Math.min(parsed, MAX_LIMIT)
	}
	const cursor = url.searchParams.get('cursor') ?? undefined
	return { fields, draft, limit, cursor }
}

// ============================================================================
// Entry projection (fields)
// ============================================================================

/**
 * Project a scanned `CollectionEntryInfo` down to the requested `fields`.
 *
 * - absent: light header (slug/title/draft/pathname/sourcePath), never the body.
 * - `*`: all frontmatter (via `data`), still no body.
 * - `a,b`: those frontmatter keys (plus the always-present slug/sourcePath).
 *
 * The body lives only behind the entry-detail route, so a list stays small even
 * for large/data collections.
 */
function projectEntry(entry: CollectionEntryInfo, fields: string | undefined): CollectionEntryInfo {
	if (fields === '*') {
		// All frontmatter, still no body. `data` already carries the full frontmatter.
		const projected: CollectionEntryInfo = { slug: entry.slug, sourcePath: entry.sourcePath }
		if (entry.title !== undefined) projected.title = entry.title
		if (entry.draft !== undefined) projected.draft = entry.draft
		if (entry.pathname !== undefined) projected.pathname = entry.pathname
		if (entry.data !== undefined) projected.data = entry.data
		return projected
	}

	if (fields === undefined || fields.trim() === '') {
		const projected: CollectionEntryInfo = { slug: entry.slug, sourcePath: entry.sourcePath }
		if (entry.title !== undefined) projected.title = entry.title
		if (entry.draft !== undefined) projected.draft = entry.draft
		if (entry.pathname !== undefined) projected.pathname = entry.pathname
		return projected
	}

	const keys = fields.split(',').map(k => k.trim()).filter(Boolean)
	// slug + sourcePath are always-present identity fields.
	const projected: CollectionEntryInfo = { slug: entry.slug, sourcePath: entry.sourcePath }
	const data: Record<string, unknown> = {}
	for (const key of keys) {
		switch (key) {
			case 'slug':
			case 'sourcePath':
				break
			case 'title':
				if (entry.title !== undefined) projected.title = entry.title
				break
			case 'draft':
				if (entry.draft !== undefined) projected.draft = entry.draft
				break
			case 'pathname':
				if (entry.pathname !== undefined) projected.pathname = entry.pathname
				break
			default: {
				const value = entry.data?.[key]
				if (value !== undefined) data[key] = value
			}
		}
	}
	if (Object.keys(data).length > 0) projected.data = data
	return projected
}

/** Apply the draft filter to a scanned entry list. */
function filterByDraft(entries: CollectionEntryInfo[], draft: EntriesQuery['draft']): CollectionEntryInfo[] {
	if (draft === 'all') return entries
	const wantDraft = draft === 'true'
	return entries.filter(e => (e.draft === true) === wantDraft)
}

/**
 * Opaque-but-real cursor: a base64url offset into the (stably scan-ordered) entry
 * list. We never silently cap — when more remain, the next cursor is returned and
 * `hasMore` is set; absent a cursor we start at offset 0.
 */
function decodeCursor(cursor: string | undefined): number {
	if (!cursor) return 0
	try {
		const decoded = Buffer.from(cursor, 'base64url').toString('utf-8')
		const offset = Number.parseInt(decoded, 10)
		return Number.isFinite(offset) && offset >= 0 ? offset : 0
	} catch {
		return 0
	}
}

function encodeCursor(offset: number): string {
	return Buffer.from(String(offset), 'utf-8').toString('base64url')
}

// ============================================================================
// Page list (sidecar-layer fs walk; cms-core has no page-listing capability)
// ============================================================================

const PAGE_EXTENSIONS = ['.astro', '.md', '.mdx']

/**
 * Walk `src/pages` through the `CmsFileSystem` port and derive static page
 * routes. Skips underscore/dot files, dynamic segments (`[...]`) and non-page
 * extensions — mirroring the dev server's filesystem page discovery. Yields
 * `pathname` only; an SEO `title` would require the render manifest (out of scope).
 */
async function listPages(fs: CmsFileSystem): Promise<PageEntry[]> {
	const pathnames: string[] = []

	async function walk(dir: string, urlPrefix: string): Promise<void> {
		const entries = await fs.list(dir)
		for (const entry of entries) {
			if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
			if (entry.name.includes('[')) continue
			const full = `${dir}/${entry.name}`
			if (entry.isDirectory) {
				await walk(full, `${urlPrefix}${entry.name}/`)
				continue
			}
			const dot = entry.name.lastIndexOf('.')
			const ext = dot >= 0 ? entry.name.slice(dot) : ''
			if (!PAGE_EXTENSIONS.includes(ext)) continue
			const baseName = entry.name.slice(0, entry.name.length - ext.length)
			const pathname = baseName === 'index'
				? (urlPrefix.replace(/\/$/, '') || '/')
				: `${urlPrefix}${baseName}`
			pathnames.push(pathname)
		}
	}

	await walk('src/pages', '/')
	pathnames.sort((a, b) => a.localeCompare(b))
	return pathnames.map(pathname => ({ pathname }))
}

// ============================================================================
// Collection → route base (sidecar-layer fs walk)
// ============================================================================

const GET_COLLECTION_RE = /getCollection\s*\(\s*['"`]([^'"`]+)['"`]/g

/**
 * How the route that renders a collection turns an entry into a URL:
 * - `perItem`: a dynamic route (`[...slug].astro`) → one page per entry, at
 *   `<base>/<slug>` (base is the route's directory, e.g. `/products`).
 * - shared page (`perItem: false`): a static page that lists the collection →
 *   every entry maps to that one page's URL (`base`, e.g. `/faq`), no slug.
 */
interface CollectionRoute {
	base: string
	perItem: boolean
}

/**
 * Map each collection to the route that renders it, by scanning the Astro pages
 * under `src/pages` for `getCollection('<name>')`. This is the only reliable source
 * for an entry's URL — it comes from the route, not the collection name (a `product`
 * collection can live at `/products`, an `faq` collection on a single `/faq` page).
 *
 * - A *dynamic* route file (`[...slug].astro`) renders one page per entry; the URL
 *   base is its directory. Only its first `getCollection` counts — that's the one its
 *   `getStaticPaths` iterates (a secondary lookup, e.g. an author on a post page,
 *   would otherwise mis-map that collection).
 * - A *static* page renders every collection it reads on that one shared URL.
 * - A per-item (dynamic) route wins over a shared page if a collection has both.
 *
 * Collections rendered nowhere are absent: their entries get no `pathname`, so a
 * consumer knows there is no page to open.
 */
async function resolveCollectionRoutes(fs: CmsFileSystem): Promise<Map<string, CollectionRoute>> {
	const routes = new Map<string, CollectionRoute>()
	const consider = (name: string, route: CollectionRoute): void => {
		const existing = routes.get(name)
		// Per-item routes win over a shared page; otherwise the first match wins.
		if (!existing || (route.perItem && !existing.perItem)) routes.set(name, route)
	}

	async function walk(dir: string, urlPrefix: string): Promise<void> {
		const entries = await fs.list(dir)
		for (const entry of entries) {
			if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
			const full = `${dir}/${entry.name}`
			if (entry.isDirectory) {
				await walk(full, `${urlPrefix}${entry.name}/`)
				continue
			}
			// `getCollection` lives in Astro page frontmatter.
			if (!entry.name.endsWith('.astro')) continue

			let content: string
			try {
				content = await fs.readFile(full)
			} catch {
				continue
			}
			const names = [...content.matchAll(GET_COLLECTION_RE)].map(m => m[1]).filter((n): n is string => Boolean(n))
			if (names.length === 0) continue

			if (entry.name.includes('[')) {
				// Dynamic route: the page-per-item collection is the getStaticPaths driver (first).
				consider(names[0]!, { base: urlPrefix.replace(/\/$/, ''), perItem: true })
			} else {
				// Static page: every collection it lists shares this page's URL.
				const baseName = entry.name.slice(0, -'.astro'.length)
				const pathname = baseName === 'index' ? (urlPrefix.replace(/\/$/, '') || '/') : `${urlPrefix}${baseName}`
				for (const name of names) consider(name, { base: pathname, perItem: false })
			}
		}
	}

	await walk('src/pages', '/')
	return routes
}

/** Build an entry's page URL from its collection route (see {@link CollectionRoute}). */
function entryPathname(route: CollectionRoute, slug: string): string {
	return route.perItem ? `${route.base}/${slug}` : (route.base || '/')
}

// ============================================================================
// Router
// ============================================================================

export interface CmsSidecarServer {
	/** The `fetch` handler — pass to `Bun.serve`, or drive directly in tests. */
	fetch(req: Request): Promise<Response>
}

export function createServer(opts: CreateServerOptions): CmsSidecarServer {
	const { core, fs, root, coreVersion } = opts
	const contentDir = opts.contentDir ?? 'src/content'
	const maxUploadSize = opts.maxUploadSize ?? 20 * 1024 * 1024
	const mutex = new KeyedMutex()

	async function scanList(): Promise<CollectionDefinition[]> {
		const map = await core.scanCollections()
		return Object.values(map)
	}

	async function resolveCollection(name: string): Promise<CollectionDefinition | null> {
		const map = await core.scanCollections()
		return map[name] ?? null
	}

	// Astro component definitions used by the headless MDX body editor (block picker
	// + block-card prop labels). Same scan that feeds updateEntry's MDX import injection.
	async function scanComponentsList(): Promise<ComponentDefinition[]> {
		const map = await core.scanComponents()
		return Object.values(map).sort((a, b) => a.name.localeCompare(b.name))
	}

	// --- Entry detail (assembles the CollectionEntry wire shape) ---
	async function entryDetail(collection: string, slug: string): Promise<Response> {
		const result = await core.getEntry(collection, slug)
		if (!result) return error('not_found', `Entry not found: ${collection}/${slug}`)

		const def = await resolveCollection(collection)
		// frontmatter values are stringified for the line-keyed wire shape; line
		// numbers are not tracked headlessly (the inline widget owns line-precise edits).
		const frontmatter: Record<string, { value: string; line: number }> = {}
		for (const [key, value] of Object.entries(result.frontmatter)) {
			frontmatter[key] = { value: typeof value === 'string' ? value : JSON.stringify(value), line: 0 }
		}
		const entry: CollectionEntry = {
			collectionName: def?.name ?? collection,
			collectionSlug: slug,
			sourcePath: result.sourcePath,
			frontmatter,
			body: result.content,
			bodyStartLine: 0,
		}
		return json(entry)
	}

	// --- GET entry asset (resolve an image/file value relative to the entry source, stream the bytes) ---
	async function assetResponse(collection: string, slug: string, url: URL): Promise<Response> {
		const assetPath = url.searchParams.get('path')
		if (assetPath === null || assetPath === '') return error('validation', 'A "path" query parameter is required')
		const asset = await core.getEntryAsset(collection, slug, assetPath)
		if (!asset) return error('not_found', `Asset not found for ${collection}/${slug}: ${assetPath}`)
		return new Response(asset.bytes, { headers: { 'content-type': asset.contentType, 'cache-control': 'no-cache' } })
	}

	// --- PATCH entry (optimistic concurrency + per-file mutex) ---
	async function patchEntry(collection: string, slug: string, body: UpdateEntryBody): Promise<Response> {
		const existing = await core.getEntry(collection, slug)
		if (!existing) return error('not_found', `Entry not found: ${collection}/${slug}`)
		const sourcePath = existing.sourcePath

		return mutex.runExclusive(sourcePath, async () => {
			// Re-hash under the lock so a concurrent writer cannot slip in between.
			const serverHash = await hashSource(fs, sourcePath)
			if (body.baseHash !== undefined && serverHash !== null && body.baseHash !== serverHash) {
				const current = await core.getEntry(collection, slug)
				const conflict: ConflictResponse = {
					code: 'conflict',
					serverHash,
					serverFrontmatter: current?.frontmatter ?? existing.frontmatter,
				}
				if (current && current.content !== '') conflict.serverBody = current.content
				return json(conflict, STATUS_BY_CODE.conflict)
			}

			const result = await core.updateEntry({
				collection,
				slug,
				frontmatter: body.frontmatter,
				body: body.body,
			})
			if (!result.success) return mutationResponse(result)

			const newHash = await hashSource(fs, result.sourcePath ?? sourcePath)
			const enriched: MutationResult = { ...result }
			if (newHash !== null) enriched.sourceHash = newHash
			return json(enriched)
		})
	}

	async function fetchHandler(req: Request): Promise<Response> {
		const url = new URL(req.url)
		let pathname = url.pathname
		if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)

		// /health is unversioned (liveness probe).
		if (pathname === '/health' && req.method === 'GET') {
			return json({ ok: true, coreVersion, root })
		}

		if (!pathname.startsWith(API_PREFIX)) {
			return error('not_found', `No route: ${req.method} ${pathname}`)
		}
		const rest = pathname.slice(API_PREFIX.length) || '/'
		const segments = rest.split('/').filter(Boolean).map(decodeURIComponent)
		const method = req.method

		return route(method, segments, req, url)
	}

	async function route(method: string, segments: string[], req: Request, url: URL): Promise<Response> {
		const [head, ...tail] = segments

		switch (head) {
			case 'health':
				if (method === 'GET') return json({ ok: true, coreVersion, root })
				break

			case 'project':
				if (method === 'GET') {
					const [collections, pages] = await Promise.all([scanList(), listPages(fs)])
					const capabilities: Capabilities = { coreVersion, features: [...SIDECAR_FEATURES] }
					const model: ProjectModel = { collections, pages, capabilities }
					return json(model)
				}
				break

			case 'components':
				if (method === 'GET') return json(await scanComponentsList())
				break

			case 'collections':
				return routeCollections(method, tail, req, url)

			case 'pages':
				return routePages(method, tail, req)

			case 'redirects':
				return routeRedirects(method, tail, req)

			case 'media':
				return routeMedia(method, tail, req, url)
		}

		return error('not_found', `No route: ${method} /cms/v1/${segments.join('/')}`)
	}

	async function routeCollections(method: string, tail: string[], req: Request, url: URL): Promise<Response> {
		// GET /collections
		if (tail.length === 0) {
			if (method === 'GET') return json(await scanList())
			return error('unsupported', `Unsupported: ${method} /collections`)
		}

		const [collection, sub, slug, action] = tail

		// /collections/:c/entries[...]
		if (sub === 'entries' && collection) {
			// GET /collections/:c/entries  (sparse list)
			if (slug === undefined) {
				if (method === 'GET') return listEntries(collection, url)
				if (method === 'POST') return createEntry(collection, req)
				return error('unsupported', `Unsupported: ${method} /collections/${collection}/entries`)
			}

			// /collections/:c/entries/:slug[...]
			if (action === undefined) {
				if (method === 'GET') return entryDetail(collection, slug)
				if (method === 'PATCH') return updateEntryRoute(collection, slug, req)
				if (method === 'DELETE') return deleteEntryRoute(collection, slug)
				return error('unsupported', `Unsupported: ${method} /collections/${collection}/entries/${slug}`)
			}

			if (action === 'rename' && method === 'POST') return renameEntryRoute(collection, slug, req)
			if (action === 'array' && method === 'POST') return addArrayRoute(collection, slug, req)
			if (action === 'array' && method === 'DELETE') return removeArrayRoute(collection, slug, req)
			if (action === 'asset' && method === 'GET') return assetResponse(collection, slug, url)
		}

		return error('not_found', `No route: ${method} /cms/v1/collections/${tail.join('/')}`)
	}

	async function listEntries(collection: string, url: URL): Promise<Response> {
		const def = await resolveCollection(collection)
		if (!def) return error('not_found', `Collection not found: ${collection}`)

		const query = parseEntriesQuery(url)
		// Tag entries with the URL of their rendered page (when the collection has a route),
		// so a consumer can sync a preview to the entry being edited. Falls back to no
		// pathname on any fs error — better absent than wrong.
		const routes = await resolveCollectionRoutes(fs).catch(() => new Map<string, CollectionRoute>())
		const route = routes.get(collection)
		const all = route === undefined
			? (def.entries ?? [])
			: (def.entries ?? []).map(e => (e.pathname === undefined ? { ...e, pathname: entryPathname(route, e.slug) } : e))
		const filtered = filterByDraft(all, query.draft)

		const offset = decodeCursor(query.cursor)
		const limit = query.limit ?? DEFAULT_LIMIT
		const page = filtered.slice(offset, offset + limit)
		const hasMore = offset + limit < filtered.length

		const entries = page.map(e => projectEntry(e, query.fields))
		const result: EntriesListResult = { entries, hasMore }
		if (hasMore) result.cursor = encodeCursor(offset + limit)
		return json(result)
	}

	async function createEntry(collection: string, req: Request): Promise<Response> {
		const parsed = await parseJson<CreateEntryBody>(req)
		if (!parsed.ok) return parsed.response
		const body = parsed.value
		if (typeof body.slug !== 'string' || body.slug.trim() === '') {
			return error('validation', 'A non-empty "slug" is required')
		}
		if (body.frontmatter === undefined || typeof body.frontmatter !== 'object') {
			return error('validation', 'A "frontmatter" object is required')
		}

		const result = await core.createEntry({
			collection,
			slug: body.slug,
			frontmatter: body.frontmatter,
			body: body.body,
			fileExtension: body.fileExtension,
		})
		if (!result.success) return mutationResponse(result)

		const newHash = result.sourcePath ? await hashSource(fs, result.sourcePath) : null
		const enriched: MutationResult = { ...result }
		if (newHash !== null) enriched.sourceHash = newHash
		return json(enriched)
	}

	async function updateEntryRoute(collection: string, slug: string, req: Request): Promise<Response> {
		const parsed = await parseJson<UpdateEntryBody>(req)
		if (!parsed.ok) return parsed.response
		return patchEntry(collection, slug, parsed.value)
	}

	async function deleteEntryRoute(collection: string, slug: string): Promise<Response> {
		const existing = await core.getEntry(collection, slug)
		if (!existing) return error('not_found', `Entry not found: ${collection}/${slug}`)
		return mutex.runExclusive(existing.sourcePath, async () => {
			const result = await core.deleteEntry(collection, slug)
			return mutationResponse(result)
		})
	}

	async function renameEntryRoute(collection: string, slug: string, req: Request): Promise<Response> {
		const parsed = await parseJson<RenameEntryBody>(req)
		if (!parsed.ok) return parsed.response
		if (typeof parsed.value.to !== 'string' || parsed.value.to.trim() === '') {
			return error('validation', 'A non-empty "to" slug is required')
		}
		const existing = await core.getEntry(collection, slug)
		if (!existing) return error('not_found', `Entry not found: ${collection}/${slug}`)
		return mutex.runExclusive(existing.sourcePath, async () => {
			const result = await core.renameEntry(collection, slug, parsed.value.to)
			if (!result.success) return mutationResponse(result)
			const newHash = result.sourcePath ? await hashSource(fs, result.sourcePath) : null
			const enriched: MutationResult = { ...result }
			if (newHash !== null) enriched.sourceHash = newHash
			return json(enriched)
		})
	}

	async function addArrayRoute(collection: string, slug: string, req: Request): Promise<Response> {
		const parsed = await parseJson<AddArrayItemBody>(req)
		if (!parsed.ok) return parsed.response
		const body = parsed.value
		if (typeof body.field !== 'string' || body.field.trim() === '') {
			return error('validation', 'A non-empty "field" is required')
		}
		const existing = await core.getEntry(collection, slug)
		if (!existing) return error('not_found', `Entry not found: ${collection}/${slug}`)
		return mutex.runExclusive(existing.sourcePath, async () => {
			const result = await core.addArrayItem({ collection, slug, field: body.field, value: body.value, index: body.index })
			return mutationResponse(result)
		})
	}

	async function removeArrayRoute(collection: string, slug: string, req: Request): Promise<Response> {
		const parsed = await parseJson<RemoveArrayItemBody>(req)
		if (!parsed.ok) return parsed.response
		const body = parsed.value
		if (typeof body.field !== 'string' || body.field.trim() === '') {
			return error('validation', 'A non-empty "field" is required')
		}
		if (typeof body.index !== 'number' || !Number.isInteger(body.index)) {
			return error('validation', 'An integer "index" is required')
		}
		const existing = await core.getEntry(collection, slug)
		if (!existing) return error('not_found', `Entry not found: ${collection}/${slug}`)
		return mutex.runExclusive(existing.sourcePath, async () => {
			const result = await core.removeArrayItem({ collection, slug, field: body.field, index: body.index })
			return mutationResponse(result)
		})
	}

	async function routePages(method: string, tail: string[], req: Request): Promise<Response> {
		const [sub] = tail

		// GET /pages  → fs-derived page list (cms-core has no page listing).
		if (sub === undefined) {
			if (method === 'GET') return json({ pages: await listPages(fs) })
			if (method === 'POST') {
				const parsed = await parseJson<Parameters<CmsCore['createPage']>[0]>(req)
				if (!parsed.ok) return parsed.response
				const result = await core.createPage(parsed.value)
				return result.success ? json(result) : error('validation', result.error ?? 'Failed to create page')
			}
			if (method === 'DELETE') {
				const parsed = await parseJson<Parameters<CmsCore['deletePage']>[0]>(req)
				if (!parsed.ok) return parsed.response
				const result = await core.deletePage(parsed.value)
				if (result.success) return json(result)
				const code: ErrorCode = /not found/i.test(result.error ?? '') ? 'not_found' : 'validation'
				return error(code, result.error ?? 'Failed to delete page')
			}
			return error('unsupported', `Unsupported: ${method} /pages`)
		}

		// GET /pages/layouts
		if (sub === 'layouts' && method === 'GET') {
			return json({ layouts: await core.getLayouts() })
		}

		// POST /pages/duplicate
		if (sub === 'duplicate' && method === 'POST') {
			const parsed = await parseJson<Parameters<CmsCore['duplicatePage']>[0]>(req)
			if (!parsed.ok) return parsed.response
			const result = await core.duplicatePage(parsed.value)
			if (result.success) return json(result)
			const code: ErrorCode = /not found/i.test(result.error ?? '') ? 'not_found' : 'validation'
			return error(code, result.error ?? 'Failed to duplicate page')
		}

		return error('not_found', `No route: ${method} /cms/v1/pages/${tail.join('/')}`)
	}

	async function routeRedirects(method: string, tail: string[], req: Request): Promise<Response> {
		const [sub] = tail

		if (sub === undefined) {
			if (method === 'GET') return json(await core.listRedirects())
			if (method === 'POST') {
				const parsed = await parseJson<Parameters<CmsCore['addRedirect']>[0]>(req)
				if (!parsed.ok) return parsed.response
				const result = await core.addRedirect(parsed.value)
				return result.success ? json(result) : error('validation', result.error ?? 'Failed to add redirect')
			}
			if (method === 'PATCH') {
				const parsed = await parseJson<Parameters<CmsCore['updateRedirect']>[0]>(req)
				if (!parsed.ok) return parsed.response
				const result = await core.updateRedirect(parsed.value)
				return result.success ? json(result) : error('validation', result.error ?? 'Failed to update redirect')
			}
			if (method === 'DELETE') {
				const parsed = await parseJson<Parameters<CmsCore['deleteRedirect']>[0]>(req)
				if (!parsed.ok) return parsed.response
				const result = await core.deleteRedirect(parsed.value)
				return result.success ? json(result) : error('validation', result.error ?? 'Failed to delete redirect')
			}
			return error('unsupported', `Unsupported: ${method} /redirects`)
		}

		return error('not_found', `No route: ${method} /cms/v1/redirects/${tail.join('/')}`)
	}

	async function routeMedia(method: string, tail: string[], req: Request, url: URL): Promise<Response> {
		const adapter = core.media
		if (!adapter) return error('unsupported', 'Media storage not configured')

		const [id] = tail

		// GET /media
		if (id === undefined && method === 'GET') {
			const rawLimit = url.searchParams.get('limit')
			const parsedLimit = rawLimit !== null ? Number.parseInt(rawLimit, 10) : Number.NaN
			const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT
			const result = await adapter.list({
				limit,
				cursor: url.searchParams.get('cursor') ?? undefined,
				folder: url.searchParams.get('folder') ?? undefined,
			})
			return json(result)
		}

		// POST /media  (multipart upload, or JSON create-folder)
		if (id === undefined && method === 'POST') {
			const contentType = req.headers.get('content-type') ?? ''
			if (contentType.includes('application/json')) {
				const parsed = await parseJson<CreateFolderBody>(req)
				if (!parsed.ok) return parsed.response
				if (!adapter.createFolder) return error('unsupported', 'Folder creation not supported by this adapter')
				if (typeof parsed.value.folder !== 'string' || parsed.value.folder.includes('..')) {
					return error('validation', 'A valid "folder" is required')
				}
				const result = await adapter.createFolder(parsed.value.folder)
				return result.success ? json(result) : error('io_error', result.error ?? 'Failed to create folder')
			}
			if (!contentType.includes('multipart/form-data')) {
				return error('validation', 'Expected multipart/form-data or application/json')
			}
			const form = await req.formData()
			const file = form.get('file')
			if (!(file instanceof File)) return error('validation', 'No "file" found in the form data')
			if (file.size > maxUploadSize) {
				return error('validation', `File too large (max ${Math.round(maxUploadSize / (1024 * 1024))} MB)`)
			}
			const buffer = Buffer.from(await file.arrayBuffer())
			const folder = url.searchParams.get('folder') ?? undefined
			const result = await adapter.upload(buffer, file.name, file.type || 'application/octet-stream', { folder })
			return result.success ? json(result) : error('io_error', result.error ?? 'Upload failed')
		}

		// DELETE /media/:id
		if (id !== undefined && method === 'DELETE') {
			const result = await adapter.delete(id)
			return result.success ? json({ success: true }) : error('io_error', result.error ?? 'Delete failed')
		}

		return error('not_found', `No route: ${method} /cms/v1/media${id ? `/${id}` : ''}`)
	}

	return { fetch: fetchHandler }
}
