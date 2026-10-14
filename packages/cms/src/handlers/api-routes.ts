import type { CmsCore, CmsFileSystem } from '@nuasite/cms-core'
import {
	CmsCommitConflictError,
	decodeFilteredMediaCursor,
	isUnsafeFolder,
	listFilteredMedia,
	listProjectImages,
	MEDIA_INVALID_FOLDER,
	MediaCursorError,
	mediaErrorStatus,
	parseMediaTypeFilter,
} from '@nuasite/cms-core'
import { filterMediaItems } from '@nuasite/cms-types'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { CollectionOverrides } from '../collection-overrides'
import { getProjectRoot } from '../config'
import { expectedDeletions } from '../expected-deletions'
import type { ManifestWriter } from '../manifest-writer'
import type { MediaStorageAdapter } from '../media/types'
import { currentProjectContext } from '../project/context'
import { scanCollections } from '../scan-cache'
import { handleAddArrayItem, handleRemoveArrayItem } from './array-ops'
import { tryAstroImageUpload } from './astro-image-upload'
import { handleInsertComponent, handleRemoveComponent } from './component-ops'
import { handleCheckSlugExists } from './page-ops'
import { BodyTooLargeError, errorResponse, jsonResponse, parseJsonRequest, parseMultipartFile, readRequestBody } from './request-utils'
import { handleUpdate } from './source-writer'

/** What the editor API routes work with; the request itself comes with each call. */
export interface ApiDependencies {
	manifestWriter: ManifestWriter
	/** The framework-agnostic brain. Structural routes delegate here. */
	core: CmsCore
	/** Raw FileSystem port (for the few helpers that scan the project directly). */
	fs: CmsFileSystem
	/** The project root `fs` and `core` are rooted at, for the paths that leave the port. */
	projectRoot: string
	contentDir: string
	mediaAdapter?: MediaStorageAdapter
	maxUploadSize: number
	/** Astro-config `collections` overrides, for the routes that rescan and republish the definitions. */
	collectionOverrides?: CollectionOverrides
}

interface ApiContext extends ApiDependencies {
	request: Request
	url: URL
}

type RouteHandler = (ctx: ApiContext) => Promise<Response>

/** The configured media adapter, or the `501` that says there is none. */
function mediaOf(ctx: ApiContext): MediaStorageAdapter | Response {
	return ctx.mediaAdapter ?? errorResponse('Media storage not configured', 501)
}

/**
 * Derive `{ collection, slug }` from a root-relative content-entry `filePath`.
 *
 * The dev API is addressed by `filePath` (e.g. `src/content/blog/hello.md`),
 * while cms-core is addressed by `{ collection, slug }`. The collection is the
 * first path segment under `contentDir`; the slug is the remainder with the
 * extension stripped (and a trailing `/index` collapsed for index-layout
 * entries). cms-core's path resolution is the exact inverse: a flat `<slug>.<ext>`
 * resolves first, an index `<slug>/index.{md,mdx}` after — so the derived pair
 * resolves back to the same file.
 */
function filePathToEntry(contentDir: string, filePath: string): { collection: string; slug: string } | null {
	const normalized = filePath.replace(/^\/+/, '')
	const prefix = `${contentDir.replace(/\/+$/, '')}/`
	if (!normalized.startsWith(prefix)) return null

	const rel = normalized.slice(prefix.length)
	const firstSlash = rel.indexOf('/')
	if (firstSlash < 0) return null

	const collection = rel.slice(0, firstSlash)
	const entryPath = rel.slice(firstSlash + 1)
	if (!collection || !entryPath) return null

	const withoutExt = entryPath.replace(/\.(md|mdx|json|yaml|yml)$/, '')
	const slug = withoutExt.replace(/\/index$/, '')
	if (!slug) return null

	return { collection, slug }
}

// -- Route helper factories --

/** POST route: parse JSON body → handler(body, manifestWriter) → JSON */
function post<T>(route: string, handler: (body: T, mw: ManifestWriter) => Promise<unknown>): [string, RouteHandler] {
	return [`POST:${route}`, async ({ request, manifestWriter }) => {
		const body = await parseJsonRequest<T>(request)
		return jsonResponse(await handler(body, manifestWriter))
	}]
}

/** {@link post} for a route that edits sources: its writes reach the project together, or not at all. */
function postMutation<T>(route: string, handler: (body: T, mw: ManifestWriter) => Promise<unknown>): [string, RouteHandler] {
	return post<T>(route, (body, mw) => currentProjectContext().mutate(() => handler(body, mw)))
}

/** POST route through cms-core: parse JSON body → handler(body, core) → JSON with success-based status */
function postCore<T>(route: string, handler: (body: T, core: CmsCore) => Promise<{ success: boolean }>): [string, RouteHandler] {
	return [`POST:${route}`, async ({ request, core }) => {
		const body = await parseJsonRequest<T>(request)
		const result = await handler(body, core)
		return jsonResponse(result, result.success ? 200 : 400)
	}]
}

/** GET route through cms-core: handler(core) → JSON */
function getCore(route: string, handler: (core: CmsCore) => Promise<unknown>): [string, RouteHandler] {
	return [`GET:${route}`, async ({ core }) => jsonResponse(await handler(core))]
}

/** Custom handler for routes that don't fit the patterns above */
function custom(method: string, route: string, handler: RouteHandler): [string, RouteHandler] {
	return [`${method}:${route}`, handler]
}

/** Allowed MIME types for media uploads. Videos are intentionally excluded —
 *  they belong on a CDN (Mux, YouTube), not in the repo's public/uploads dir. */
const ALLOWED_UPLOAD_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/avif',
	'image/x-icon',
	'application/pdf',
])

/** Frontmatter shape the create route enriches with title/date for markdown entries. */
interface CreateMarkdownBody {
	collection: string
	title: string
	slug: string
	frontmatter?: Record<string, unknown>
	content?: string
	fileExtension?: string
}

interface UpdateMarkdownBody {
	filePath: string
	frontmatter?: Record<string, unknown>
	content?: string
}

interface DeleteMarkdownBody {
	filePath: string
}

interface RenameMarkdownBody {
	filePath: string
	newSlug: string
}

interface DuplicatePageBody {
	sourcePagePath: string
	slug: string
	title?: string
	layoutPath?: string
	createRedirect?: boolean
}

interface DeletePageBody {
	pagePath: string
	createRedirect?: boolean
	redirectTo?: string
}

const DATA_EXTENSIONS = new Set(['json', 'yaml', 'yml'])

/** O(1) route lookup map: "METHOD:route" → handler */
const routeMap = new Map<string, RouteHandler>([
	// Source editing — manifest-coupled, stays in @nuasite/cms
	post('update', (body: Parameters<typeof handleUpdate>[0], mw) => handleUpdate(body, mw)),
	// `update` commits file by file itself, so one file that changed meanwhile fails only its own changes.
	postMutation('insert-component', (body: Parameters<typeof handleInsertComponent>[0], mw) => handleInsertComponent(body, mw)),
	postMutation('remove-component', (body: Parameters<typeof handleRemoveComponent>[0], mw) => handleRemoveComponent(body, mw)),
	postMutation('add-array-item', (body: Parameters<typeof handleAddArrayItem>[0], mw) => handleAddArrayItem(body, mw)),
	postMutation('remove-array-item', (body: Parameters<typeof handleRemoveArrayItem>[0], mw) => handleRemoveArrayItem(body, mw)),

	// Markdown / entry CRUD — structural, delegated to cms-core
	custom('GET', 'markdown/content', async ({ url, core, contentDir }) => {
		const filePath = url.searchParams.get('filePath')
		if (!filePath) return errorResponse('filePath query parameter required')
		const entry = filePathToEntry(contentDir, filePath)
		const result = entry ? await core.getEntry(entry.collection, entry.slug) : null
		if (!result) return errorResponse('File not found', 404)
		return jsonResponse({ content: result.content, frontmatter: result.frontmatter, filePath })
	}),
	custom('POST', 'markdown/update', async ({ request, core, contentDir }) => {
		const body = await parseJsonRequest<UpdateMarkdownBody>(request)
		const entry = filePathToEntry(contentDir, body.filePath)
		if (!entry) return jsonResponse({ success: false, error: `Invalid content path: ${body.filePath}` })
		// cms-core's updateEntry resolves component definitions internally for MDX imports.
		const result = await core.updateEntry({
			collection: entry.collection,
			slug: entry.slug,
			frontmatter: body.frontmatter,
			body: body.content,
		})
		return jsonResponse({ success: result.success, ...(result.error ? { error: result.error } : {}) })
	}),
	custom('POST', 'markdown/rename', async ({ request, core, contentDir }) => {
		const body = await parseJsonRequest<RenameMarkdownBody>(request)
		const entry = filePathToEntry(contentDir, body.filePath)
		if (!entry) return jsonResponse({ success: false, error: `Invalid content path: ${body.filePath}` })
		const result = await core.renameEntry(entry.collection, entry.slug, body.newSlug)
		if (!result.success) return jsonResponse({ success: false, error: result.error })
		const newSlug = result.sourcePath ? lastSlug(result.sourcePath) : undefined
		return jsonResponse({ success: true, newFilePath: result.sourcePath, newSlug })
	}),
	custom('POST', 'markdown/create', async ({ request, core, manifestWriter, contentDir, collectionOverrides }) => {
		const body = await parseJsonRequest<CreateMarkdownBody>(request)
		const ext = body.fileExtension ?? 'md'
		const isData = DATA_EXTENSIONS.has(ext)
		// Markdown entries get title + an ISO date injected; data entries take frontmatter verbatim.
		const frontmatter = isData
			? { ...(body.frontmatter ?? {}) }
			: { title: body.title, date: new Date().toISOString().split('T')[0]!, ...(body.frontmatter ?? {}) }

		const result = await core.createEntry({
			collection: body.collection,
			slug: body.slug || body.title,
			frontmatter,
			body: body.content,
			fileExtension: body.fileExtension,
		})

		if (result.success) {
			manifestWriter.setCollectionDefinitions(await scanCollections(contentDir, collectionOverrides))
		}
		const slug = result.sourcePath ? lastSlug(result.sourcePath) : undefined
		return jsonResponse(
			{
				success: result.success,
				...(result.sourcePath ? { filePath: result.sourcePath } : {}),
				...(slug ? { slug } : {}),
				...(result.error ? { error: result.error } : {}),
			},
			result.success ? 200 : 400,
		)
	}),
	custom('POST', 'markdown/delete', async ({ request, core, manifestWriter, contentDir, collectionOverrides }) => {
		const body = await parseJsonRequest<DeleteMarkdownBody>(request)
		const entry = filePathToEntry(contentDir, body.filePath)
		if (!entry) return jsonResponse({ success: false, error: `Invalid content path: ${body.filePath}` }, 400)
		const fullPath = path.resolve(getProjectRoot(), body.filePath.replace(/^\//, ''))
		expectedDeletions.add(fullPath)
		const result = await core.deleteEntry(entry.collection, entry.slug)
		if (result.success) {
			manifestWriter.setCollectionDefinitions(await scanCollections(contentDir, collectionOverrides))
		} else {
			expectedDeletions.delete(fullPath)
		}
		return jsonResponse({ success: result.success, ...(result.error ? { error: result.error } : {}) }, result.success ? 200 : 400)
	}),

	// Media
	custom('GET', 'media/list', async (ctx) => {
		const adapter = mediaOf(ctx)
		if (adapter instanceof Response) return adapter
		const params = ctx.url.searchParams
		const parsedLimit = parseInt(params.get('limit') ?? '50', 10)
		const limit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 50 : Math.min(parsedLimit, 1000)
		const folder = params.get('folder') ?? undefined
		const type = parseMediaTypeFilter(params.get('type'))
		if (type === null) return errorResponse('type accepts "all", "photo", "graphic", "video" or "document"')
		const cursor = params.get('cursor') ?? undefined
		// A `?type=` page is paged by `listFilteredMedia`'s own cursor, bound to the tab it was
		// minted under; it refuses one from another tab itself. Followed with no `?type=`, the
		// adapter would read it as its own cursor and answer with an empty page, so say so instead.
		if (type === 'all' && cursor !== undefined && decodeFilteredMediaCursor(cursor) !== null) {
			return errorResponse('This cursor continues a ?type= listing: keep the filter set when following it')
		}
		try {
			return jsonResponse(await listFilteredMedia(options => adapter.list(options), { limit, cursor, folder, type }))
		} catch (error) {
			if (!(error instanceof MediaCursorError)) throw error
			return errorResponse(error.message)
		}
	}),
	custom('GET', 'media/project-images', async (ctx) => {
		const type = parseMediaTypeFilter(ctx.url.searchParams.get('type'))
		if (type === null) return errorResponse('type accepts "all", "photo", "graphic", "video" or "document"')
		const items = await listProjectImages(ctx.fs, { exclude: { dir: ctx.mediaAdapter?.staticFiles?.dir, root: ctx.projectRoot } })
		// Unpaged, so the filter is the whole story here — the caller never has to drain.
		return jsonResponse({ items: filterMediaItems(items, type), appliedType: type })
	}),
	custom('POST', 'media/upload', async (ctx) => {
		const contentType = ctx.request.headers.get('content-type') ?? ''
		if (!contentType.includes('multipart/form-data')) return errorResponse('Expected multipart/form-data')

		const limit = ctx.maxUploadSize
		const tooLargeMsg = `File too large (max ${Math.round(limit / (1024 * 1024))} MB)`

		// Reject early via Content-Length so we don't stream a huge payload only to drop it.
		const declared = parseInt(ctx.request.headers.get('content-length') ?? '', 10)
		if (Number.isFinite(declared) && declared > limit) return errorResponse(tooLargeMsg, 413)

		const query = ctx.url.searchParams
		let body: Buffer
		try {
			body = await readRequestBody(ctx.request, limit)
		} catch (err) {
			if (err instanceof BodyTooLargeError) return errorResponse(tooLargeMsg, 413)
			throw err
		}
		const file = parseMultipartFile(body, contentType)
		if (!file) return errorResponse('No file found in request')
		// Block SVG (can contain scripts) unless explicitly served with safe headers
		if (!ALLOWED_UPLOAD_TYPES.has(file.contentType)) return errorResponse(`File type not allowed: ${file.contentType}`)

		// Astro image() fields write entry-relative — bypasses the media adapter so
		// the file lands in src/content where astro:assets can pick it up.
		const astroResult = await currentProjectContext().mutate(() =>
			tryAstroImageUpload({
				context: {
					collection: query.get('collection') ?? undefined,
					entry: query.get('entry') ?? undefined,
					field: query.get('field') ?? undefined,
				},
				manifestWriter: ctx.manifestWriter,
				fileBuffer: file.buffer,
				originalFilename: file.filename,
			})
		)
		if (astroResult) return jsonResponse(astroResult, astroResult.success ? 200 : 400)

		const adapter = mediaOf(ctx)
		if (adapter instanceof Response) return adapter
		const folder = query.get('folder') ?? undefined
		return jsonResponse(await adapter.upload(file.buffer, file.filename, file.contentType, { folder }))
	}),
	custom('POST', 'media/folder', async (ctx) => {
		const adapter = mediaOf(ctx)
		if (adapter instanceof Response) return adapter
		if (!adapter.createFolder) return errorResponse('Folder creation not supported by this storage adapter', 501)
		const body = await parseJsonRequest<{ folder: string }>(ctx.request)
		if (!body.folder || typeof body.folder !== 'string') return errorResponse('folder field is required')
		// Held to the same rule as the bundled adapters for whatever adapter is configured.
		if (isUnsafeFolder(body.folder)) return errorResponse(MEDIA_INVALID_FOLDER)
		const result = await adapter.createFolder(body.folder)
		return jsonResponse(result, result.success ? 200 : 400)
	}),

	// Page operations — structural, delegated to cms-core
	postCore('page/create', (body: Parameters<CmsCore['createPage']>[0], core) => core.createPage(body)),
	custom('POST', 'page/duplicate', async ({ request, core }) => {
		const body = await parseJsonRequest<DuplicatePageBody>(request)
		const result = await core.duplicatePage(body)
		if (result.success && body.createRedirect) {
			await core.addRedirect({ source: body.sourcePagePath, destination: result.url!, statusCode: 307 })
		}
		return jsonResponse(result, result.success ? 200 : 400)
	}),
	custom('POST', 'page/delete', async ({ request, core }) => {
		const body = await parseJsonRequest<DeletePageBody>(request)
		const result = await core.deletePage(body)
		if (result.success && result.filePath) {
			expectedDeletions.add(path.resolve(getProjectRoot(), result.filePath))
		}
		if (result.success && body.createRedirect && body.redirectTo) {
			await core.addRedirect({ source: body.pagePath, destination: body.redirectTo, statusCode: 307 })
		}
		return jsonResponse(result, result.success ? 200 : 400)
	}),
	custom('GET', 'page/check-slug', async ({ url }) => {
		const slug = url.searchParams.get('slug')
		if (!slug) return errorResponse('slug query parameter required')
		return jsonResponse(await handleCheckSlugExists(slug))
	}),
	getCore('page/layouts', async (core) => ({ layouts: await core.getLayouts() })),

	// Redirects — structural, delegated to cms-core
	getCore('redirects', (core) => core.listRedirects()),
	postCore('redirects/add', (body: Parameters<CmsCore['addRedirect']>[0], core) => core.addRedirect(body)),
	postCore('redirects/update', (body: Parameters<CmsCore['updateRedirect']>[0], core) => core.updateRedirect(body)),
	postCore('redirects/delete', (body: Parameters<CmsCore['deleteRedirect']>[0], core) => core.deleteRedirect(body)),

	// Deployment
	get('deployment/status', async () => ({ currentDeployment: null, pendingCount: 0, deploymentEnabled: false })),
])

/** GET route returning a fixed/static payload (no cms-core needed). */
function get(route: string, handler: () => Promise<unknown>): [string, RouteHandler] {
	return [`GET:${route}`, async () => jsonResponse(await handler())]
}

/** Last path segment of a root-relative source path, with the extension and a trailing `/index` stripped. */
function lastSlug(sourcePath: string): string {
	const withoutExt = sourcePath.replace(/\.(md|mdx|json|yaml|yml)$/, '').replace(/\/index$/, '')
	const slash = withoutExt.lastIndexOf('/')
	return slash >= 0 ? withoutExt.slice(slash + 1) : withoutExt
}

/**
 * Answer one editor API request. `route` is the part of the path after `/_nua/cms/`, as it was
 * sent (still percent-encoded); the query is read from `request.url`.
 */
export async function handleCmsApiRequest(route: string, request: Request, deps: ApiDependencies): Promise<Response> {
	const ctx: ApiContext = { ...deps, request, url: new URL(request.url) }
	try {
		return await routeRequest(route, ctx)
	} catch (error) {
		// A project context with a commit fence refused writes based on files that changed meanwhile.
		if (error instanceof CmsCommitConflictError) return jsonResponse({ success: false, error: error.message, conflict: true }, 409)
		throw error
	}
}

async function routeRequest(route: string, ctx: ApiContext): Promise<Response> {
	const { request } = ctx

	// Exact match lookup
	const handler = routeMap.get(`${request.method}:${route}`)
	if (handler) return handler(ctx)

	// DELETE /_nua/cms/media/<id> — dynamic route with ID segment
	if (request.method === 'DELETE' && route.startsWith('media/')) {
		const adapter = mediaOf(ctx)
		if (adapter instanceof Response) return adapter
		const id = route.slice('media/'.length)
		if (!id || id === 'list' || id === 'upload') return errorResponse('Not found', 404)
		let decoded: string
		try {
			decoded = decodeURIComponent(id)
		} catch {
			return errorResponse('Invalid media id')
		}
		const result = await adapter.delete(decoded)
		// The same statuses as the sidecar: 400 for a refused id, 404 for a missing file, 500 otherwise.
		return jsonResponse(result, result.success ? 200 : mediaErrorStatus(result.error))
	}

	return errorResponse('Not found', 404)
}

export interface RouteContext extends ApiDependencies {
	req: IncomingMessage
	res: ServerResponse
	route: string
}

/** {@link handleCmsApiRequest} for a `node:http` request, as the Astro dev server hands it over. */
export async function handleCmsApiRoute(ctx: RouteContext): Promise<void> {
	const { req, res, route, ...deps } = ctx
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
	const headers = new Headers()
	for (const [name, value] of Object.entries(req.headers)) {
		if (typeof value === 'string') headers.set(name, value)
		else if (Array.isArray(value)) { for (const item of value) headers.append(name, item) }
	}
	const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers }
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		// Streamed, so the route's own size limit stops an oversized body as it arrives.
		init.body = new ReadableStream<Uint8Array>({
			start(controller) {
				req.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
				req.on('end', () => controller.close())
				req.on('error', error => controller.error(error))
			},
			cancel() {
				req.destroy()
			},
		})
		// Node's fetch refuses a streamed body without it.
		init.duplex = 'half'
	}
	const response = await handleCmsApiRequest(route, new Request(url.href, init), deps)
	res.writeHead(response.status, Object.fromEntries(response.headers))
	res.end(Buffer.from(await response.arrayBuffer()))
}
