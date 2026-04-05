import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { scanCollections } from '../collection-scanner'
import { getProjectRoot } from '../config'
import { expectedDeletions } from '../dev-middleware'
import type { ManifestWriter } from '../manifest-writer'
import { listProjectImages } from '../media/project-images'
import type { MediaStorageAdapter } from '../media/types'
import { handleAddArrayItem, handleRemoveArrayItem } from './array-ops'
import { handleInsertComponent, handleRemoveComponent } from './component-ops'
import { handleCreateMarkdown, handleDeleteMarkdown, handleGetMarkdownContent, handleRenameMarkdown, handleUpdateMarkdown } from './markdown-ops'
import { handleCheckSlugExists, handleCreatePage, handleDeletePage, handleDuplicatePage, handleGetLayouts } from './page-ops'
import { handleAddRedirect, handleDeleteRedirect, handleGetRedirects, handleUpdateRedirect } from './redirect-ops'
import { parseJsonBody, parseMultipartFile, readBody, sendError, sendJson } from './request-utils'
import { handleUpdate } from './source-writer'

export interface RouteContext {
	req: IncomingMessage
	res: ServerResponse
	route: string
	manifestWriter: ManifestWriter
	contentDir: string
	mediaAdapter?: MediaStorageAdapter
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

// -- Route helper factories --

/** POST route: parse JSON body → handler(body, manifestWriter) → sendJson */
function post<T>(route: string, handler: (body: T, mw: ManifestWriter) => Promise<unknown>): [string, RouteHandler] {
	return [`POST:${route}`, async ({ req, res, manifestWriter }) => {
		const body = await parseJsonBody<T>(req)
		sendJson(res, await handler(body, manifestWriter))
	}]
}

/** POST route: parse JSON body → handler(body) → sendJson with success-based status */
function postWithStatus<T>(route: string, handler: (body: T) => Promise<{ success: boolean }>): [string, RouteHandler] {
	return [`POST:${route}`, async ({ req, res }) => {
		const body = await parseJsonBody<T>(req)
		const result = await handler(body)
		sendJson(res, result, result.success ? 200 : 400)
	}]
}

/** GET route: handler() → sendJson */
function get(route: string, handler: () => Promise<unknown>): [string, RouteHandler] {
	return [`GET:${route}`, async ({ res }) => {
		sendJson(res, await handler())
	}]
}

/** Custom handler for routes that don't fit the patterns above */
function custom(method: string, route: string, handler: RouteHandler): [string, RouteHandler] {
	return [`${method}:${route}`, handler]
}

/** Allowed MIME types for media uploads */
const ALLOWED_UPLOAD_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/avif',
	'image/x-icon',
	'video/mp4',
	'video/webm',
	'application/pdf',
])

/** O(1) route lookup map: "METHOD:route" → handler */
const routeMap = new Map<string, RouteHandler>([
	// Source editing
	post('update', (body: Parameters<typeof handleUpdate>[0], mw) => handleUpdate(body, mw)),
	post('insert-component', (body: Parameters<typeof handleInsertComponent>[0], mw) => handleInsertComponent(body, mw)),
	post('remove-component', (body: Parameters<typeof handleRemoveComponent>[0], mw) => handleRemoveComponent(body, mw)),
	post('add-array-item', (body: Parameters<typeof handleAddArrayItem>[0], mw) => handleAddArrayItem(body, mw)),
	post('remove-array-item', (body: Parameters<typeof handleRemoveArrayItem>[0], mw) => handleRemoveArrayItem(body, mw)),

	// Markdown CRUD
	custom('GET', 'markdown/content', async ({ req, res }) => {
		const filePath = getQuery({ req } as RouteContext).get('filePath')
		if (!filePath) {
			sendError(res, 'filePath query parameter required')
			return
		}
		const result = await handleGetMarkdownContent(filePath)
		if (!result) {
			sendError(res, 'File not found', 404)
			return
		}
		sendJson(res, result)
	}),
	custom('POST', 'markdown/update', async ({ req, res, manifestWriter }) => {
		const body = await parseJsonBody<Parameters<typeof handleUpdateMarkdown>[0]>(req)
		sendJson(res, await handleUpdateMarkdown(body, manifestWriter.getComponentDefinitions()))
	}),
	post('markdown/rename', (body: Parameters<typeof handleRenameMarkdown>[0]) => handleRenameMarkdown(body)),
	postWithStatus('markdown/create', (body: Parameters<typeof handleCreateMarkdown>[0]) => handleCreateMarkdown(body)),
	custom('POST', 'markdown/delete', async ({ req, res, manifestWriter, contentDir }) => {
		const body = await parseJsonBody<Parameters<typeof handleDeleteMarkdown>[0]>(req)
		const fullPath = path.resolve(getProjectRoot(), body.filePath?.replace(/^\//, '') ?? '')
		expectedDeletions.add(fullPath)
		const result = await handleDeleteMarkdown(body)
		if (result.success) {
			manifestWriter.setCollectionDefinitions(await scanCollections(contentDir))
		} else {
			expectedDeletions.delete(fullPath)
		}
		sendJson(res, result, result.success ? 200 : 400)
	}),

	// Media
	custom('GET', 'media/list', async (ctx) => {
		if (!requireMedia(ctx)) return
		const params = getQuery(ctx)
		const parsedLimit = parseInt(params.get('limit') ?? '50', 10)
		const limit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 50 : Math.min(parsedLimit, 1000)
		sendJson(ctx.res, await ctx.mediaAdapter.list({ limit, cursor: params.get('cursor') ?? undefined }))
	}),
	custom('GET', 'media/project-images', async (ctx) => {
		const excludeDir = ctx.mediaAdapter?.staticFiles?.dir
		const items = await listProjectImages({ excludeDir })
		sendJson(ctx.res, { items })
	}),
	custom('POST', 'media/upload', async (ctx) => {
		if (!requireMedia(ctx)) return
		const contentType = ctx.req.headers['content-type'] ?? ''
		if (!contentType.includes('multipart/form-data')) {
			sendError(ctx.res, 'Expected multipart/form-data')
			return
		}
		const body = await readBody(ctx.req, 50 * 1024 * 1024)
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
		sendJson(ctx.res, await ctx.mediaAdapter.upload(file.buffer, file.filename, file.contentType))
	}),

	// Page operations
	postWithStatus('page/create', (body: Parameters<typeof handleCreatePage>[0]) => handleCreatePage(body)),
	custom('POST', 'page/duplicate', async ({ req, res }) => {
		const body = await parseJsonBody<Parameters<typeof handleDuplicatePage>[0]>(req)
		const result = await handleDuplicatePage(body)
		if (result.success && body.createRedirect) {
			await handleAddRedirect({ source: body.sourcePagePath, destination: result.url!, statusCode: 307 })
		}
		sendJson(res, result, result.success ? 200 : 400)
	}),
	custom('POST', 'page/delete', async ({ req, res }) => {
		const body = await parseJsonBody<Parameters<typeof handleDeletePage>[0]>(req)
		const result = await handleDeletePage(body)
		if (result.success && result.filePath) {
			expectedDeletions.add(path.resolve(getProjectRoot(), result.filePath))
		}
		if (result.success && body.createRedirect && body.redirectTo) {
			await handleAddRedirect({ source: body.pagePath, destination: body.redirectTo, statusCode: 307 })
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
	get('page/layouts', async () => ({ layouts: await handleGetLayouts() })),

	// Redirects
	get('redirects', () => handleGetRedirects()),
	postWithStatus('redirects/add', (body: Parameters<typeof handleAddRedirect>[0]) => handleAddRedirect(body)),
	postWithStatus('redirects/update', (body: Parameters<typeof handleUpdateRedirect>[0]) => handleUpdateRedirect(body)),
	postWithStatus('redirects/delete', (body: Parameters<typeof handleDeleteRedirect>[0]) => handleDeleteRedirect(body)),

	// Deployment
	get('deployment/status', async () => ({ currentDeployment: null, pendingCount: 0, deploymentEnabled: false })),
])

export async function handleCmsApiRoute(
	route: string,
	req: IncomingMessage,
	res: ServerResponse,
	manifestWriter: ManifestWriter,
	contentDir: string,
	mediaAdapter?: MediaStorageAdapter,
): Promise<void> {
	const ctx: RouteContext = { req, res, route, manifestWriter, contentDir, mediaAdapter }

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
