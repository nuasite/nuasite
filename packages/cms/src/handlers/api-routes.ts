import type { CmsCore, CmsFileSystem } from '@nuasite/cms-core'
import { listProjectImages } from '@nuasite/cms-core'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { scanCollections } from '../collection-scanner'
import { getProjectRoot } from '../config'
import { expectedDeletions } from '../dev-middleware'
import type { ManifestWriter } from '../manifest-writer'
import type { MediaStorageAdapter } from '../media/types'
import { handleAddArrayItem, handleRemoveArrayItem } from './array-ops'
import { tryAstroImageUpload } from './astro-image-upload'
import { handleInsertComponent, handleRemoveComponent } from './component-ops'
import { handleCheckSlugExists } from './page-ops'
import { BodyTooLargeError, parseJsonBody, parseMultipartFile, readBody, sendError, sendJson } from './request-utils'
import { handleUpdate } from './source-writer'

export interface RouteContext {
	req: IncomingMessage
	res: ServerResponse
	route: string
	manifestWriter: ManifestWriter
	/** The framework-agnostic brain. Structural routes delegate here. */
	core: CmsCore
	/** Raw FileSystem port (for the few helpers that scan the project directly). */
	fs: CmsFileSystem
	contentDir: string
	mediaAdapter?: MediaStorageAdapter
	maxUploadSize: number
}

type RouteHandler = (ctx: RouteContext) => Promise<void>

function requireMedia(ctx: RouteContext): ctx is RouteContext & { mediaAdapter: MediaStorageAdapter } {
	if (!ctx.mediaAdapter) {
		sendError(ctx.res, 'Media storage not configured', 501)
		return false
	}
	return true
}

function getQuery(ctx: RouteContext): URLSearchParams {
	return new URL(ctx.req.url!, `http://${ctx.req.headers.host}`).searchParams
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

/** POST route: parse JSON body → handler(body, manifestWriter) → sendJson */
function post<T>(route: string, handler: (body: T, mw: ManifestWriter) => Promise<unknown>): [string, RouteHandler] {
	return [`POST:${route}`, async ({ req, res, manifestWriter }) => {
		const body = await parseJsonBody<T>(req)
		sendJson(res, await handler(body, manifestWriter))
	}]
}

/** POST route through cms-core: parse JSON body → handler(body, core) → sendJson with success-based status */
function postCore<T>(route: string, handler: (body: T, core: CmsCore) => Promise<{ success: boolean }>): [string, RouteHandler] {
	return [`POST:${route}`, async ({ req, res, core }) => {
		const body = await parseJsonBody<T>(req)
		const result = await handler(body, core)
		sendJson(res, result, result.success ? 200 : 400)
	}]
}

/** GET route through cms-core: handler(core) → sendJson */
function getCore(route: string, handler: (core: CmsCore) => Promise<unknown>): [string, RouteHandler] {
	return [`GET:${route}`, async ({ res, core }) => {
		sendJson(res, await handler(core))
	}]
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
	post('insert-component', (body: Parameters<typeof handleInsertComponent>[0], mw) => handleInsertComponent(body, mw)),
	post('remove-component', (body: Parameters<typeof handleRemoveComponent>[0], mw) => handleRemoveComponent(body, mw)),
	post('add-array-item', (body: Parameters<typeof handleAddArrayItem>[0], mw) => handleAddArrayItem(body, mw)),
	post('remove-array-item', (body: Parameters<typeof handleRemoveArrayItem>[0], mw) => handleRemoveArrayItem(body, mw)),

	// Markdown / entry CRUD — structural, delegated to cms-core
	custom('GET', 'markdown/content', async ({ req, res, core, contentDir }) => {
		const filePath = getQuery({ req } as RouteContext).get('filePath')
		if (!filePath) {
			sendError(res, 'filePath query parameter required')
			return
		}
		const entry = filePathToEntry(contentDir, filePath)
		const result = entry ? await core.getEntry(entry.collection, entry.slug) : null
		if (!result) {
			sendError(res, 'File not found', 404)
			return
		}
		sendJson(res, { content: result.content, frontmatter: result.frontmatter, filePath })
	}),
	custom('POST', 'markdown/update', async ({ req, res, core, contentDir }) => {
		const body = await parseJsonBody<UpdateMarkdownBody>(req)
		const entry = filePathToEntry(contentDir, body.filePath)
		if (!entry) {
			sendJson(res, { success: false, error: `Invalid content path: ${body.filePath}` })
			return
		}
		// cms-core's updateEntry resolves component definitions internally for MDX imports.
		const result = await core.updateEntry({
			collection: entry.collection,
			slug: entry.slug,
			frontmatter: body.frontmatter,
			body: body.content,
		})
		sendJson(res, { success: result.success, ...(result.error ? { error: result.error } : {}) })
	}),
	custom('POST', 'markdown/rename', async ({ req, res, core, contentDir }) => {
		const body = await parseJsonBody<RenameMarkdownBody>(req)
		const entry = filePathToEntry(contentDir, body.filePath)
		if (!entry) {
			sendJson(res, { success: false, error: `Invalid content path: ${body.filePath}` })
			return
		}
		const result = await core.renameEntry(entry.collection, entry.slug, body.newSlug)
		if (!result.success) {
			sendJson(res, { success: false, error: result.error })
			return
		}
		const newSlug = result.sourcePath ? lastSlug(result.sourcePath) : undefined
		sendJson(res, { success: true, newFilePath: result.sourcePath, newSlug })
	}),
	custom('POST', 'markdown/create', async ({ req, res, core, manifestWriter, contentDir }) => {
		const body = await parseJsonBody<CreateMarkdownBody>(req)
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
			manifestWriter.setCollectionDefinitions(await scanCollections(contentDir))
		}
		const slug = result.sourcePath ? lastSlug(result.sourcePath) : undefined
		sendJson(
			res,
			{
				success: result.success,
				...(result.sourcePath ? { filePath: result.sourcePath } : {}),
				...(slug ? { slug } : {}),
				...(result.error ? { error: result.error } : {}),
			},
			result.success ? 200 : 400,
		)
	}),
	custom('POST', 'markdown/delete', async ({ req, res, core, manifestWriter, contentDir }) => {
		const body = await parseJsonBody<DeleteMarkdownBody>(req)
		const entry = filePathToEntry(contentDir, body.filePath)
		if (!entry) {
			sendJson(res, { success: false, error: `Invalid content path: ${body.filePath}` }, 400)
			return
		}
		const fullPath = path.resolve(getProjectRoot(), body.filePath.replace(/^\//, ''))
		expectedDeletions.add(fullPath)
		const result = await core.deleteEntry(entry.collection, entry.slug)
		if (result.success) {
			manifestWriter.setCollectionDefinitions(await scanCollections(contentDir))
		} else {
			expectedDeletions.delete(fullPath)
		}
		sendJson(res, { success: result.success, ...(result.error ? { error: result.error } : {}) }, result.success ? 200 : 400)
	}),

	// Media
	custom('GET', 'media/list', async (ctx) => {
		if (!requireMedia(ctx)) return
		const params = getQuery(ctx)
		const parsedLimit = parseInt(params.get('limit') ?? '50', 10)
		const limit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 50 : Math.min(parsedLimit, 1000)
		const folder = params.get('folder') ?? undefined
		sendJson(ctx.res, await ctx.mediaAdapter.list({ limit, cursor: params.get('cursor') ?? undefined, folder }))
	}),
	custom('GET', 'media/project-images', async (ctx) => {
		const excludeDir = ctx.mediaAdapter?.staticFiles?.dir
		const items = await listProjectImages(ctx.fs, { excludeDir })
		sendJson(ctx.res, { items })
	}),
	custom('POST', 'media/upload', async (ctx) => {
		const contentType = ctx.req.headers['content-type'] ?? ''
		if (!contentType.includes('multipart/form-data')) {
			sendError(ctx.res, 'Expected multipart/form-data')
			return
		}

		const limit = ctx.maxUploadSize
		const tooLargeMsg = `File too large (max ${Math.round(limit / (1024 * 1024))} MB)`

		// Reject early via Content-Length so we don't stream a huge payload only to drop it.
		const declared = parseInt(ctx.req.headers['content-length'] ?? '', 10)
		if (Number.isFinite(declared) && declared > limit) {
			sendError(ctx.res, tooLargeMsg, 413)
			return
		}

		const query = getQuery(ctx)
		let body: Buffer
		try {
			body = await readBody(ctx.req, limit)
		} catch (err) {
			if (err instanceof BodyTooLargeError) {
				sendError(ctx.res, tooLargeMsg, 413)
				return
			}
			throw err
		}
		const file = parseMultipartFile(body, contentType)
		if (!file) {
			sendError(ctx.res, 'No file found in request')
			return
		}
		// Block SVG (can contain scripts) unless explicitly served with safe headers
		if (!ALLOWED_UPLOAD_TYPES.has(file.contentType)) {
			sendError(ctx.res, `File type not allowed: ${file.contentType}`)
			return
		}

		// Astro image() fields write entry-relative — bypasses the media adapter so
		// the file lands in src/content where astro:assets can pick it up.
		const astroResult = await tryAstroImageUpload({
			context: {
				collection: query.get('collection') ?? undefined,
				entry: query.get('entry') ?? undefined,
				field: query.get('field') ?? undefined,
			},
			manifestWriter: ctx.manifestWriter,
			fileBuffer: file.buffer,
			originalFilename: file.filename,
		})
		if (astroResult) {
			sendJson(ctx.res, astroResult, astroResult.success ? 200 : 400)
			return
		}

		if (!requireMedia(ctx)) return
		const folder = query.get('folder') ?? undefined
		sendJson(ctx.res, await ctx.mediaAdapter.upload(file.buffer, file.filename, file.contentType, { folder }))
	}),
	custom('POST', 'media/folder', async (ctx) => {
		if (!requireMedia(ctx)) return
		if (!ctx.mediaAdapter.createFolder) {
			sendError(ctx.res, 'Folder creation not supported by this storage adapter', 501)
			return
		}
		const body = await parseJsonBody<{ folder: string }>(ctx.req)
		if (!body.folder || typeof body.folder !== 'string') {
			sendError(ctx.res, 'folder field is required')
			return
		}
		if (body.folder.includes('..')) {
			sendError(ctx.res, 'Invalid folder name')
			return
		}
		const result = await ctx.mediaAdapter.createFolder(body.folder)
		sendJson(ctx.res, result, result.success ? 200 : 400)
	}),

	// Page operations — structural, delegated to cms-core
	postCore('page/create', (body: Parameters<CmsCore['createPage']>[0], core) => core.createPage(body)),
	custom('POST', 'page/duplicate', async ({ req, res, core }) => {
		const body = await parseJsonBody<DuplicatePageBody>(req)
		const result = await core.duplicatePage(body)
		if (result.success && body.createRedirect) {
			await core.addRedirect({ source: body.sourcePagePath, destination: result.url!, statusCode: 307 })
		}
		sendJson(res, result, result.success ? 200 : 400)
	}),
	custom('POST', 'page/delete', async ({ req, res, core }) => {
		const body = await parseJsonBody<DeletePageBody>(req)
		const result = await core.deletePage(body)
		if (result.success && result.filePath) {
			expectedDeletions.add(path.resolve(getProjectRoot(), result.filePath))
		}
		if (result.success && body.createRedirect && body.redirectTo) {
			await core.addRedirect({ source: body.pagePath, destination: body.redirectTo, statusCode: 307 })
		}
		sendJson(res, result, result.success ? 200 : 400)
	}),
	custom('GET', 'page/check-slug', async (ctx) => {
		const slug = getQuery(ctx).get('slug')
		if (!slug) {
			sendError(ctx.res, 'slug query parameter required')
			return
		}
		sendJson(ctx.res, await handleCheckSlugExists(slug))
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
	return [`GET:${route}`, async ({ res }) => {
		sendJson(res, await handler())
	}]
}

/** Last path segment of a root-relative source path, with the extension and a trailing `/index` stripped. */
function lastSlug(sourcePath: string): string {
	const withoutExt = sourcePath.replace(/\.(md|mdx|json|yaml|yml)$/, '').replace(/\/index$/, '')
	const slash = withoutExt.lastIndexOf('/')
	return slash >= 0 ? withoutExt.slice(slash + 1) : withoutExt
}

export async function handleCmsApiRoute(ctx: RouteContext): Promise<void> {
	const { req, res, route } = ctx

	// Exact match lookup
	const handler = routeMap.get(`${req.method}:${route}`)
	if (handler) {
		await handler(ctx)
		return
	}

	// DELETE /_nua/cms/media/<id> — dynamic route with ID segment
	if (req.method === 'DELETE' && route.startsWith('media/')) {
		if (!requireMedia(ctx)) return
		const id = route.slice('media/'.length)
		if (!id || id === 'list' || id === 'upload') {
			sendError(res, 'Not found', 404)
			return
		}
		sendJson(res, await ctx.mediaAdapter!.delete(decodeURIComponent(id)))
		return
	}

	sendError(res, 'Not found', 404)
}
