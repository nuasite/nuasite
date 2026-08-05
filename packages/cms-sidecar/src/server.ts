import {
	type CmsCore,
	type CmsFileSystem,
	listFilteredMedia,
	listProjectImages,
	parseMediaTypeFilter,
	parseProjectCmsConfig,
	resolvePathnameFromSpec,
} from '@nuasite/cms-core'
import { filterMediaItems } from '@nuasite/cms-types'
import type {
	CmsConfig,
	CollectionDefinition,
	CollectionEntry,
	CollectionEntryInfo,
	ComponentDefinition,
	MediaFolderItem,
	MediaItem,
	MediaListResult,
	MediaStorageAdapter,
	MediaTypeFilter,
	MutationResult,
} from '@nuasite/cms-types'
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
	'project.asset',
	'entry.optimistic-concurrency',
	'pages.crud',
	'pages.list',
	'pages.layouts',
	'redirects.crud',
	'media',
	'media.project-images',
	'media.type-filter',
	'components',
	'config',
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
// Media listing (adapter + project scan)
// ============================================================================

/**
 * Where a merged `GET /media` page continues from. The two sources are listed in
 * phases, never interleaved: the adapter first (its own opaque cursor), then the
 * project scan (an offset into its stable, total-ordered list). `project` being
 * present is what marks the adapter phase as finished.
 *
 * The cursor is self-identifying (`v`), so a caller that loses the
 * `?includeProjectImages` flag mid-scroll gets a 400 instead of having our private
 * cursor handed to the adapter, which would parse it as garbage.
 *
 * A `?type=` listing is paged by cursors we mint for the same reason, merged or not: every
 * position one marks is a position in the *filtered* stream, so following it under a different tab
 * would address a different list. An unfiltered listing still hands the adapter's own cursor
 * through untouched, exactly as before.
 */
interface MediaCursorState {
	/** The adapter's own continuation cursor. */
	adapter?: string
	/** Offset into the project image scan. */
	project?: number
	/**
	 * The adapter's root folder list, carried so later pages keep reporting it: the
	 * project phase never calls the adapter, and `folders` describes the listed
	 * directory rather than the item stream, so a client that does
	 * `setFolders(page.folders)` must not lose the tree mid-scroll. The list is the
	 * media root's only (the merge is disabled for `?folder=`), so it stays small.
	 */
	folders?: MediaFolderItem[]
	/**
	 * The tab the cursor was minted under, when it was minted under one. Absent means no filter,
	 * which is also how every cursor minted before `?type=` existed decodes.
	 */
	type?: MediaTypeFilter
}

const MEDIA_CURSOR_VERSION = 1

/** The tab a decoded cursor belongs to; absent has always meant "the whole listing". */
function cursorType(state: MediaCursorState): MediaTypeFilter {
	return state.type ?? 'all'
}

const CURSOR_TYPE_MISMATCH = 'This cursor continues a listing filtered by a different ?type= — start the listing again when the filter changes'

function encodeMediaCursor(state: MediaCursorState): string {
	return Buffer.from(JSON.stringify({ v: MEDIA_CURSOR_VERSION, ...state }), 'utf8').toString('base64url')
}

function parseCursorFolders(value: unknown): MediaFolderItem[] | null {
	if (!Array.isArray(value)) return null
	const entries: readonly unknown[] = value
	const folders: MediaFolderItem[] = []
	for (const entry of entries) {
		if (typeof entry !== 'object' || entry === null) return null
		if (!('name' in entry) || typeof entry.name !== 'string') return null
		if (!('path' in entry) || typeof entry.path !== 'string') return null
		folders.push({ name: entry.name, path: entry.path })
	}
	return folders
}

/**
 * Decode a merge cursor. Anything that is not a cursor *we* minted is rejected —
 * including a well-formed but positionless one (`{}`, `[]`, `{"foo":1}`), which
 * would otherwise silently restart the listing at page 1.
 */
function decodeMediaCursor(raw: string | undefined): { ok: true; state: MediaCursorState } | { ok: false } {
	if (raw === undefined) return { ok: true, state: {} }
	let parsed: unknown
	try {
		parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
	} catch {
		return { ok: false }
	}
	if (typeof parsed !== 'object' || parsed === null) return { ok: false }
	if (!('v' in parsed) || parsed.v !== MEDIA_CURSOR_VERSION) return { ok: false }
	const state: MediaCursorState = {}
	if ('adapter' in parsed) {
		if (typeof parsed.adapter !== 'string') return { ok: false }
		state.adapter = parsed.adapter
	}
	if ('project' in parsed) {
		if (typeof parsed.project !== 'number' || !Number.isInteger(parsed.project) || parsed.project < 0) return { ok: false }
		state.project = parsed.project
	}
	if ('folders' in parsed) {
		const folders = parseCursorFolders(parsed.folders)
		if (folders === null) return { ok: false }
		state.folders = folders
	}
	if ('type' in parsed) {
		if (typeof parsed.type !== 'string') return { ok: false }
		const type = parseMediaTypeFilter(parsed.type)
		if (type === null) return { ok: false }
		state.type = type
	}
	// We only ever mint a cursor that carries a position; one without is malformed.
	if (state.adapter === undefined && state.project === undefined) return { ok: false }
	return { ok: true, state }
}

/**
 * `?includeProjectImages` — present with no value, `true` or `1` enable it; `false`
 * or `0` disable it. `null` means the caller sent something else, which is a client
 * error: silently ignoring e.g. `TRUE` would drop the project images without a word.
 */
function parseIncludeProjectImages(raw: string | null): boolean | null {
	if (raw === null) return false
	if (raw === '' || raw === 'true' || raw === '1') return true
	if (raw === 'false' || raw === '0') return false
	return null
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
 * The `getCollection` names inside a page's `getStaticPaths` block — the collections it
 * enumerates into pages (one page per entry). A single dynamic route may drive several,
 * and every one is page-per-item. `getCollection` calls in the render body (a secondary
 * lookup, e.g. an author on a post page) are deliberately excluded.
 *
 * Returns `null` when there is no `getStaticPaths` (e.g. an SSR `prerender=false` route),
 * so the caller can fall back to its own heuristic.
 */
function getStaticPathsCollections(content: string): string[] | null {
	const head = /getStaticPaths\s*\(/.exec(content)
	if (!head) return null
	// Skip the parameter list (it may destructure, e.g. `({ paginate })`) to reach the body brace.
	let i = head.index + head[0].length
	let parens = 1
	for (; i < content.length && parens > 0; i++) {
		if (content[i] === '(') parens++
		else if (content[i] === ')') parens--
	}
	const open = content.indexOf('{', i)
	if (parens !== 0 || open === -1) return null
	// Brace-match the function body, then scan getCollection only within it.
	let depth = 0
	for (let j = open; j < content.length; j++) {
		if (content[j] === '{') depth++
		else if (content[j] === '}' && --depth === 0) {
			const body = content.slice(open + 1, j)
			return [...body.matchAll(GET_COLLECTION_RE)].map(m => m[1]).filter((n): n is string => Boolean(n))
		}
	}
	return null
}

/**
 * Map each collection to the route that renders it, by scanning the Astro pages
 * under `src/pages` for `getCollection('<name>')`. This is the only reliable source
 * for an entry's URL — it comes from the route, not the collection name (a `product`
 * collection can live at `/products`, an `faq` collection on a single `/faq` page).
 *
 * - A *dynamic* route (`[...slug].astro`, or a `[slug]/index.astro` directory) renders one
 *   page per entry; the URL base is the path up to its dynamic segment. Every collection
 *   its `getStaticPaths` enumerates is page-per-item here — a single `[slug]` detail may
 *   drive several (a shared detail for `products` + `references` + …). Render-body
 *   `getCollection` lookups (e.g. an author on a post page) are excluded; when there is no
 *   `getStaticPaths` block to read, only the first `getCollection` counts.
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

			// Full route path: directory prefix + file segment (Astro drops `index`).
			const baseName = entry.name.slice(0, -'.astro'.length)
			const routePath = baseName === 'index' ? urlPrefix : `${urlPrefix}${baseName}`
			// A dynamic segment (`[slug]`, `[...slug]`) anywhere in the path makes this a
			// page-per-item route — whether it comes from the filename (`[...slug].astro`) or
			// a parent directory (`[slug]/index.astro`). Its base is the path up to the first
			// dynamic segment (Astro segments are always whole, so `/[` is the marker).
			const dynamicIdx = routePath.indexOf('/[')
			if (dynamicIdx !== -1) {
				const base = routePath.slice(0, dynamicIdx) || '/'
				// Every collection the route's getStaticPaths enumerates is page-per-item; a single
				// [slug] detail may drive several. Fall back to the first getCollection when there
				// is no getStaticPaths block to read (e.g. an SSR route).
				const drivers = getStaticPathsCollections(content)
				for (const name of new Set(drivers && drivers.length > 0 ? drivers : [names[0]!])) {
					consider(name, { base, perItem: true })
				}
			} else {
				// Static page: every collection it lists shares this page's URL.
				const pathname = routePath.replace(/\/$/, '') || '/'
				for (const name of names) consider(name, { base: pathname, perItem: false })
			}
		}
	}

	await walk('src/pages', '/')
	return routes
}

/** Build an entry's page URL from its collection route (see {@link CollectionRoute}). */
function entryPathname(route: CollectionRoute, slug: string): string {
	if (!route.perItem) return route.base || '/'
	// A root-level `[slug]` route has base `/`; joining naively would double the slash.
	return `${route.base === '/' ? '' : route.base}/${slug}`
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

	async function readConfig(): Promise<CmsConfig> {
		return parseProjectCmsConfig(fs)
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

	// --- GET project asset (resolve a root-relative /assets|/uploads value with no owning entry) ---
	async function projectAssetResponse(url: URL): Promise<Response> {
		const assetPath = url.searchParams.get('path')
		if (assetPath === null || assetPath === '') return error('validation', 'A "path" query parameter is required')
		const asset = await core.getProjectAsset(assetPath)
		if (!asset) return error('not_found', `Asset not found: ${assetPath}`)
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

			case 'config':
				if (method === 'GET') return json(await readConfig())
				break

			case 'asset':
				if (method === 'GET') return projectAssetResponse(url)
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
		const all = (def.entries ?? []).map(e => {
			if (e.pathname !== undefined) return e
			// A declarative `cms.pathname` rule is authoritative: derive the entry's
			// URL from its fields (e.g. topic/urlFamily + slug), matching the site's
			// forward resolver. This is what lets an entry whose URL segment differs
			// from its filename slug — people stored as `<role>__<slug>.md` served at
			// `/<family>/<slug>`, or the same slug under two topic prefixes — resolve
			// to the correct page in the editor iframe instead of a guessed
			// `<route-prefix>/<filename-slug>`.
			const fromSpec = resolvePathnameFromSpec(def, e.data)
			if (fromSpec !== undefined) return { ...e, pathname: fromSpec }
			// No rule: fall back to the discovered route prefix + slug (unchanged
			// behavior for collections that don't declare `cms.pathname`).
			if (route !== undefined) return { ...e, pathname: entryPathname(route, e.slug) }
			return e
		})
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

	/**
	 * One page over both media sources: the storage adapter (uploads) and the project
	 * scan (images committed under `public/` and `src/`, e.g. by an agent). The two
	 * are listed in phases, never interleaved — the adapter is drained first, then the
	 * scan tops the page up — so a caller that keeps following `cursor` sees every
	 * item exactly once, in the scan's stable total order (filename, then URL).
	 *
	 * What it costs and what it does not promise:
	 * - the scan is unpaginated by nature, so it re-walks `public/` and `src/` on
	 *   every page that reaches the scan phase, plus once at the end of the adapter
	 *   phase to top that page up;
	 * - a page holds at most `limit` items as long as the adapter honours `limit`; an
	 *   over-returning adapter makes it longer. Paging terminates either way, because
	 *   the scan slice is bounded by the room the adapter left;
	 * - `folders` is the adapter's, carried through the cursor so that every page —
	 *   including the scan-only ones, which never call the adapter — reports it.
	 */
	async function listMergedMedia(
		adapter: MediaStorageAdapter,
		limit: number,
		rawCursor: string | undefined,
		type: MediaTypeFilter,
	): Promise<Response> {
		const decoded = decodeMediaCursor(rawCursor)
		if (!decoded.ok) return error('validation', 'Invalid media cursor')
		if (rawCursor !== undefined && cursorType(decoded.state) !== type) return error('validation', CURSOR_TYPE_MISMATCH)
		const { adapter: adapterCursor, project: projectOffset, folders: carriedFolders } = decoded.state

		const items: MediaItem[] = []
		let folders: MediaFolderItem[] = carriedFolders ?? []

		// A `project` offset in the cursor means the adapter pages are already spent.
		if (projectOffset === undefined) {
			// Filtered above the adapter, which cannot do it itself — see `listFilteredMedia`. The
			// cursor it hands back is still one the adapter minted, so the phase resumes normally.
			const page = await listFilteredMedia(options => adapter.list(options), { limit, cursor: adapterCursor, type })
			items.push(...page.items)
			folders = page.folders
			// An adapter that reports more pages but hands back no cursor cannot be advanced. Stop
			// here anyway — falling through to the scan would silently drop the rest of its items.
			if (page.hasMore) {
				const cursor = page.cursor === undefined ? undefined : encodeMediaCursor({ adapter: page.cursor, folders, type })
				const more: MediaListResult = { items, folders, hasMore: true, cursor, appliedType: type }
				return json(more)
			}
		}

		// The scan is one unpaginated list, so its filter is a plain one — and the offset the cursor
		// carries indexes the *filtered* list, which is stable for as long as the tree is.
		const offset = projectOffset ?? 0
		const projectImages = filterMediaItems(await listProjectImages(fs, { exclude: { dir: adapter.staticFiles?.dir, root } }), type)
		const slice = projectImages.slice(offset, offset + Math.max(0, limit - items.length))
		items.push(...slice)

		const next = offset + slice.length
		const hasMore = next < projectImages.length
		const result: MediaListResult = {
			items,
			folders,
			hasMore,
			cursor: hasMore ? encodeMediaCursor({ project: next, folders, type }) : undefined,
			appliedType: type,
		}
		return json(result)
	}

	/**
	 * `GET /media` lists the storage adapter alone by default. `?includeProjectImages`
	 * (bare, or `=true` / `=1`; root only, no `folder`) merges in the project scan behind
	 * a composite cursor — see `listMergedMedia`. Advertised as the `media.project-images`
	 * feature. An unrecognised flag value, or a merge cursor followed without the flag,
	 * is a 400 rather than a silently different listing.
	 */
	async function routeMedia(method: string, tail: string[], req: Request, url: URL): Promise<Response> {
		const adapter = core.media
		if (!adapter) return error('unsupported', 'Media storage not configured')

		const [id] = tail

		// GET /media
		if (id === undefined && method === 'GET') {
			const rawLimit = url.searchParams.get('limit')
			const parsedLimit = rawLimit !== null ? Number.parseInt(rawLimit, 10) : Number.NaN
			const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT
			const folder = url.searchParams.get('folder') ?? undefined
			const cursor = url.searchParams.get('cursor') ?? undefined
			const includeProjectImages = parseIncludeProjectImages(url.searchParams.get('includeProjectImages'))
			if (includeProjectImages === null) {
				return error('validation', 'includeProjectImages accepts no value, "true", "1", "false" or "0"')
			}
			const type = parseMediaTypeFilter(url.searchParams.get('type'))
			if (type === null) {
				return error('validation', 'type accepts "all", "photo", "graphic", "video" or "document"')
			}

			// The project scan has no folder structure, so it only makes sense at the
			// media root — inside a folder the adapter stays the only source.
			if (!includeProjectImages || folder !== undefined) {
				if (type === 'all') {
					// Our own cursor means nothing to the adapter, which would parse it as an
					// offset of NaN and answer with an empty, hasMore:false page — the library
					// would look empty. Say what actually went wrong instead.
					if (cursor !== undefined && decodeMediaCursor(cursor).ok) {
						return error('validation', 'This cursor continues an ?includeProjectImages listing — keep the flag set and drop ?folder when following it')
					}
					return json(await adapter.list({ limit, cursor, folder }))
				}
				// A filtered page ends wherever the source happened to be once the page was full, so
				// the position it hands back belongs to this tab. Wrap the adapter's cursor in ours
				// to say so, and refuse one minted under another tab rather than answering from the
				// wrong place in the listing.
				const decoded = decodeMediaCursor(cursor)
				if (!decoded.ok) return error('validation', 'Invalid media cursor')
				if (cursor !== undefined && cursorType(decoded.state) !== type) return error('validation', CURSOR_TYPE_MISMATCH)

				const page = await listFilteredMedia(options => adapter.list(options), { limit, cursor: decoded.state.adapter, folder, type })
				return json({
					...page,
					cursor: page.cursor === undefined ? undefined : encodeMediaCursor({ adapter: page.cursor, type }),
				})
			}
			return listMergedMedia(adapter, limit, cursor, type)
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
