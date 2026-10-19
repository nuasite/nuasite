import { createCmsCore, createNodeFs, resolveByteRange } from '@nuasite/cms-core'
import fs from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { CollectionOverrides } from './collection-overrides'
import { getProjectRoot } from './config'
import { EditorService } from './editor-service'
import { handleCmsApiRoute } from './handlers/api-routes'
import { handleCors, sendError } from './handlers/request-utils'
import type { ManifestWriter } from './manifest-writer'
import type { MediaStorageAdapter } from './media/types'
import { currentProjectContext } from './project/context'
import type { CmsMarkerOptions, ComponentDefinition } from './types'
import { normalizePagePath } from './utils'

/** Minimal ViteDevServer interface to avoid version conflicts between Astro's bundled Vite and root Vite */
interface ViteDevServerLike {
	middlewares: {
		use: (middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void
	}
	transformIndexHtml: (url: string, html: string) => Promise<string>
	watcher?: {
		on: (event: string, listener: (...args: any[]) => void) => any
		removeListener: (event: string, listener: (...args: any[]) => void) => any
		emit: (event: string, ...args: any[]) => boolean
	}
}

export interface DevMiddlewareOptions {
	enableCmsApi?: boolean
	mediaAdapter?: MediaStorageAdapter
	/**
	 * Predicate that returns true for request URLs which should bypass CMS rewriting
	 * (typically vendor HTML under Astro's publicDir whose inline scripts can be
	 * corrupted by injected markers).
	 */
	isPublicStaticFile?: (urlPath: string) => boolean
	/** Maximum upload size in bytes for /_nua/cms/media/upload. */
	maxUploadSize: number
	/** Astro-config `collections` overrides, re-applied to the rescan an entry create or delete triggers. */
	collectionOverrides?: CollectionOverrides
}

export function createDevMiddleware(
	server: ViteDevServerLike,
	config: Required<CmsMarkerOptions>,
	manifestWriter: ManifestWriter,
	componentDefinitions: Record<string, ComponentDefinition>,
	idCounter: { value: number },
	options: DevMiddlewareOptions,
) {
	const isPublicStaticFile = options.isPublicStaticFile ?? (() => false)
	const editor = new EditorService({ context: currentProjectContext(), config, manifestWriter, componentDefinitions })

	// Serve uploaded media files directly from disk.
	// Vite's public dir middleware caches file listings, so newly uploaded files
	// may not be available immediately. This middleware bypasses that cache.
	if (options.mediaAdapter?.staticFiles) {
		const { urlPrefix, dir } = options.mediaAdapter.staticFiles
		const prefix = urlPrefix.endsWith('/') ? urlPrefix : `${urlPrefix}/`

		server.middlewares.use((req, res, next) => {
			const pathname = (req.url || '').split('?')[0] || ''
			if (!pathname.startsWith(prefix)) {
				next()
				return
			}

			const filename = path.basename(pathname)
			if (!filename || filename.includes('..')) {
				next()
				return
			}

			const filePath = path.join(dir, filename)
			fs.readFile(filePath)
				.then((data) => {
					const ext = path.extname(filename).toLowerCase()
					res.setHeader('Content-Type', mediaMimeFromExt(ext))
					res.setHeader('Cache-Control', 'no-store')
					res.setHeader('Accept-Ranges', 'bytes')
					// A <video> preview seeks through Range requests; Safari plays nothing without them.
					const range = resolveByteRange(req.headers.range ?? null, data.byteLength)
					if (range === 'unsatisfiable') {
						res.statusCode = 416
						res.setHeader('Content-Range', `bytes */${data.byteLength}`)
						res.end()
						return
					}
					if (range !== null) {
						res.statusCode = 206
						res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${data.byteLength}`)
						res.end(data.subarray(range.start, range.end + 1))
						return
					}
					res.end(data)
				})
				.catch(() => next())
		})
	}

	// CMS API endpoints (local dev server backend)
	if (options.enableCmsApi) {
		// One cms-core instance per project root. Structural routes (entry/page/redirect
		// CRUD, media) delegate to this brain over a node:fs adapter; the media adapter
		// and component dirs mirror the selection @nuasite/cms makes for the dev server.
		const projectRoot = getProjectRoot()
		const cmsFs = createNodeFs(projectRoot)
		const core = createCmsCore(cmsFs, {
			contentDir: config.contentDir,
			media: options.mediaAdapter,
			componentDirs: config.componentDirs,
		})

		server.middlewares.use((req, res, next) => {
			const url = req.url || ''
			if (!url.startsWith('/_nua/cms/')) {
				next()
				return
			}

			if (handleCors(req, res)) return

			const route = url.replace('/_nua/cms/', '').split('?')[0]!

			handleCmsApiRoute({
				req,
				res,
				route,
				manifestWriter,
				core,
				fs: cmsFs,
				projectRoot,
				contentDir: config.contentDir,
				mediaAdapter: options.mediaAdapter,
				maxUploadSize: options.maxUploadSize,
				collectionOverrides: options.collectionOverrides,
			})
				.catch((error) => {
					console.error('[astro-cms] API error:', error)
					sendError(res, 'Internal server error', 500)
				})
		})
	}

	// Serve global CMS manifest (component definitions, available colors, collection definitions, and settings)
	server.middlewares.use(async (req, res, next) => {
		const pathname = (req.url || '').split('?')[0]
		if (pathname === '/cms-manifest.json') {
			res.setHeader('Content-Type', 'application/json')
			res.setHeader('Access-Control-Allow-Origin', '*')
			res.setHeader('Cache-Control', 'no-store')
			res.end(JSON.stringify(await editor.globalManifest(), null, 2))
			return
		}
		next()
	})

	// Serve per-page manifest endpoints (e.g., /about.json for /about page)
	server.middlewares.use(async (req, res, next) => {
		const url = (req.url || '').split('?')[0]!

		// Match /*.json pattern (but not files that actually exist)
		const match = url.match(/^\/(.*)\.json$/)
		if (match) {
			// /about.json -> /about, /index.json -> /, /blog/post.json -> /blog/post
			const pagePath = match[1] === 'index' ? '/' : '/' + match[1]
			const manifest = await editor.pageManifest(pagePath)
			if (manifest) {
				res.setHeader('Content-Type', 'application/json')
				res.setHeader('Access-Control-Allow-Origin', '*')
				res.setHeader('Cache-Control', 'no-store')
				res.end(JSON.stringify(manifest, null, 2))
				return
			}
		}
		next()
	})

	// Transform HTML responses — only buffer when Content-Type is text/html
	server.middlewares.use((req, res, next) => {
		const requestUrl = req.url || 'unknown'

		// Vendor HTML under publicDir is passed through untouched — the CMS rewriter
		// can corrupt files with inline-script patterns it doesn't expect.
		if (isPublicStaticFile(requestUrl)) {
			next()
			return
		}

		const originalWrite = res.write
		const originalEnd = res.end
		let chunks: Buffer[] | null = null
		let isHtml: boolean | null = null

		const checkIfHtml = (): boolean => {
			if (isHtml !== null) return isHtml
			const contentType = res.getHeader('content-type')
			isHtml = !!(contentType && typeof contentType === 'string' && contentType.includes('text/html'))
			if (isHtml) {
				chunks = []
			}
			return isHtml
		}

		// Intercept response chunks — only buffer for HTML
		res.write = ((chunk: any, encodingOrCb?: any, cb?: any) => {
			if (!checkIfHtml()) {
				// Not HTML — pass through immediately, preserving backpressure
				return originalWrite.call(res, chunk, encodingOrCb, cb)
			}
			if (chunk) {
				chunks!.push(
					typeof chunk === 'string' ? Buffer.from(chunk, typeof encodingOrCb === 'string' ? encodingOrCb as BufferEncoding : 'utf-8') : Buffer.from(chunk),
				)
			}
			if (typeof encodingOrCb === 'function') encodingOrCb()
			else if (typeof cb === 'function') cb()
			return true
		}) as any

		res.end = ((chunk: any, ...args: any[]) => {
			if (!checkIfHtml()) {
				// Not HTML — pass through
				res.write = originalWrite
				res.end = originalEnd
				return res.end(chunk, ...args)
			}

			// Skip CMS processing for internal preview pages
			if (requestUrl.startsWith('/_nua/preview')) {
				res.write = originalWrite
				res.end = originalEnd
				return (res.end as any)(chunk, ...args)
			}

			if (chunk) {
				chunks!.push(Buffer.from(chunk))
			}

			const html = Buffer.concat(chunks!).toString('utf8')
			const pagePath = normalizePagePath(requestUrl)

			// Mark the HTML and send it; source resolution continues after the response.
			editor.processPage(pagePath, html)
				.then((transformed) => {
					res.write = originalWrite
					res.end = originalEnd
					if (!res.headersSent) {
						res.removeHeader('content-length')
					}
					res.end(transformed, ...args)
				})
				.catch((error) => {
					console.error('[cms] Error transforming HTML:', error)

					res.write = originalWrite
					res.end = originalEnd

					if (chunks!.length > 0) {
						return res.end(Buffer.concat(chunks!), ...args)
					}
					return res.end(...args)
				})
			return
		}) as any

		next()
	})
}

function mediaMimeFromExt(ext: string): string {
	const map: Record<string, string> = {
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.png': 'image/png',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.avif': 'image/avif',
		'.ico': 'image/x-icon',
		'.mp4': 'video/mp4',
		'.webm': 'video/webm',
		'.pdf': 'application/pdf',
	}
	return map[ext] ?? 'application/octet-stream'
}
