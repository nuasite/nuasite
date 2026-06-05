/**
 * Local-mode admin server (cms-headless F7).
 *
 * In `local` mode (`pletivo dev` on a developer machine), `@nuasite/cms` gives the
 * same full-page collections admin as the webmaster tab — reusing the exact
 * `@nuasite/collections-admin` SPA — instead of the cramped in-iframe collection
 * form. This module wires two things into Astro's Vite dev server:
 *
 *  1. an **in-process** cms-sidecar (`@nuasite/cms-sidecar` `createServer` over
 *     `createCmsCore(createNodeFs(root))`) mounted at `/_nua/cms-admin-api/*`,
 *     forwarding to the sidecar's `/cms/v1` contract;
 *  2. the collections-admin SPA served at `/_nua/admin`, with
 *     `apiBase = /_nua/cms-admin-api/cms/v1`.
 *
 * Both are **lazy**: nothing is built on `pletivo dev` startup. The sidecar core
 * is created on the first `/_nua/admin` (or API) hit and reused thereafter, so
 * dev startup stays fast.
 *
 * The sidecar runs in-process (not a child `bunx` process) on purpose: the dev
 * server already runs under Bun/Node, the sidecar's `createServer` is a pure
 * Web-standard `fetch` handler, and `createCmsCore(createNodeFs(root))` is the
 * very same brain the legacy `/_nua/cms` dev API already builds here. In-process
 * avoids a port allocation, a `bunx` cold-start, and a network hop on every
 * request — and keeps `pletivo dev` a single self-contained process.
 */

import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
// `@nuasite/cms-sidecar` is an OPTIONAL peer (cms-headless F6 slim): a generated
// site that depends on `@nuasite/cms` must not pull the sidecar (+ collections-admin
// + React) into its resolved tree. The TYPES are imported `import type` (erased at
// build, so no runtime dependency edge), and the VALUES are loaded lazily via a
// dynamic `import()` only when local mode actually serves `/_nua/admin`. Hosted
// (sandbox) mode never registers this middleware, so it never imports the peer.
import type { CmsSidecarServer, createServer as CreateSidecarServer } from '@nuasite/cms-sidecar'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getProjectRoot } from './config'
import { readBody } from './handlers/request-utils'
import type { MediaStorageAdapter } from './media/types'

/** Minimal Vite dev-server surface this module needs (kept loose to dodge Vite version skew). */
export interface AdminViteServerLike {
	middlewares: {
		use: (middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void
	}
	transformIndexHtml: (url: string, html: string) => Promise<string>
}

export interface LocalAdminOptions {
	/** Content collections directory, relative to the project root. */
	contentDir: string
	/** Component directories, used by the core for MDX import resolution. */
	componentDirs: string[]
	/** Media adapter for the sidecar's `/media` routes (defaults to `local` in this mode). */
	mediaAdapter?: MediaStorageAdapter
	/** Max upload size in bytes for sidecar media uploads. */
	maxUploadSize: number
	/** Virtual-module id of the SPA entry the HTML shell loads (transformed by Vite). */
	entryModuleId: string
	/**
	 * Loader for the optional peers (cms-headless F6). Defaults to the real
	 * dynamic-`import()` loader; injectable so a test can simulate the peers being
	 * absent. The peers are loaded lazily on first `/_nua/admin` hit, never on
	 * `pletivo dev` startup.
	 */
	peerLoader?: AdminPeerLoader
}

/** URL the collections-admin SPA is served at. */
export const ADMIN_ROUTE = '/_nua/admin'

/** Local mount of the in-process sidecar. The SPA's `apiBase` targets `${API_PREFIX}/cms/v1`. */
export const ADMIN_API_PREFIX = '/_nua/cms-admin-api'

/** `apiBase` passed to the SPA — the sidecar serves its routes under `/cms/v1`. */
export const ADMIN_API_BASE = `${ADMIN_API_PREFIX}/cms/v1`

/**
 * Message shown when local mode tries to open `/_nua/admin` but the optional
 * peers (`@nuasite/cms-sidecar` + `@nuasite/collections-admin`) are not installed.
 * The marker pipeline + inline editing keep working — only the full-page admin is
 * unavailable until the peers are added (or the site is run via pletivo).
 */
export const ADMIN_PEERS_MISSING_MESSAGE =
	'Local CMS admin requires @nuasite/cms-sidecar and @nuasite/collections-admin — install them (or run via pletivo) to enable /_nua/admin.'

/**
 * Loader seam for the two optional peers (cms-headless F6). The default
 * implementation loads them lazily via dynamic `import()` — the only dynamic
 * imports in this package (user-approved) — keeping them out of a slim generated
 * site's resolved tree. Injectable so a test can simulate the peers being absent
 * without uninstalling them from the workspace.
 */
export interface AdminPeerLoader {
	/** Resolve `@nuasite/cms-sidecar`'s `createServer`, or `null` if the peer is absent. */
	loadCreateSidecar(): Promise<typeof CreateSidecarServer | null>
	/** Whether `@nuasite/collections-admin` (the SPA the shell mounts) is installed. */
	isCollectionsAdminInstalled(): Promise<boolean>
}

/**
 * Default peer loader: lazily `import()` the optional peers on first use. The
 * module ids are bound to `const`s so they are NOT static-import string literals —
 * a slim site that doesn't install the peers never resolves them, and the import
 * only runs in local mode on the first `/_nua/admin` (or admin-api) hit. Both
 * rejections (peer absent) degrade to `null` / `false` rather than throwing.
 */
export const defaultAdminPeerLoader: AdminPeerLoader = {
	async loadCreateSidecar() {
		const moduleId = '@nuasite/cms-sidecar'
		const loaded = await import(moduleId).then(
			(mod: { createServer: typeof CreateSidecarServer }) => mod,
			() => null,
		)
		return loaded === null ? null : loaded.createServer
	},
	async isCollectionsAdminInstalled() {
		const moduleId = '@nuasite/collections-admin'
		return import(moduleId).then(
			() => true,
			() => false,
		)
	},
}

/**
 * Build the HTML shell for the admin SPA. It loads the virtual entry module
 * (which imports the lib's stylesheet and mounts `<CollectionsAdminApp apiBase={…} />`),
 * and injects the resolved `apiBase` as a window global so the entry needs no
 * build config. The host-agnostic SPA is reused verbatim — only `apiBase` differs
 * from the webmaster tab.
 */
function adminShellHtml(entryModuleId: string, apiBase: string): string {
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Collections — Nua CMS</title>
		<style>
			html, body, #nua-admin-root { height: 100%; margin: 0; }
			body { background: #f8fafc; }
		</style>
		<script>window.__NUA_ADMIN_API_BASE__ = ${JSON.stringify(apiBase)};</script>
	</head>
	<body>
		<div id="nua-admin-root"></div>
		<script type="module" src=${JSON.stringify(entryModuleId)}></script>
	</body>
</html>
`
}

/**
 * Lazily create the in-process cms-sidecar over the project's `node:fs`. The core
 * is built once on first use and reused; the media adapter mirrors the dev
 * server's selection (local `public/uploads` by default in this mode).
 *
 * Returns `null` when the optional `@nuasite/cms-sidecar` peer is not installed —
 * callers serve the {@link ADMIN_PEERS_MISSING_MESSAGE} placeholder rather than
 * crashing. The dynamic `import()` of the peer happens here, on first use only.
 */
function makeLazySidecar(options: LocalAdminOptions, peerLoader: AdminPeerLoader): () => Promise<CmsSidecarServer | null> {
	let server: CmsSidecarServer | null = null
	return async () => {
		if (server) return server
		const createServer = await peerLoader.loadCreateSidecar()
		if (createServer === null) return null
		const root = getProjectRoot()
		const fs = createNodeFs(root)
		const core = createCmsCore(fs, {
			contentDir: options.contentDir,
			media: options.mediaAdapter,
			componentDirs: options.componentDirs,
		})
		server = createServer({
			core,
			fs,
			root,
			// In-process: the core ships with the site's @nuasite/cms version, so the
			// package version is not separately meaningful — report it as local.
			coreVersion: 'local',
			contentDir: options.contentDir,
			maxUploadSize: options.maxUploadSize,
		})
		return server
	}
}

/** Build a Web `Request` from a Node `IncomingMessage` (+ already-buffered body). */
function toWebRequest(req: IncomingMessage, path: string, body: Buffer | undefined): Request {
	const host = req.headers.host ?? 'localhost'
	const url = `http://${host}${path}`
	const headers = new Headers()
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue
		if (Array.isArray(value)) {
			for (const v of value) headers.append(key, v)
		} else {
			headers.set(key, value)
		}
	}
	const method = req.method ?? 'GET'
	const init: RequestInit = { method, headers }
	if (method !== 'GET' && method !== 'HEAD' && body !== undefined && body.length > 0) {
		// `Buffer` is not directly a DOM `BodyInit`; copy into a standalone
		// `Uint8Array` (a valid `ArrayBufferView` body) over its own `ArrayBuffer`.
		const bytes = new Uint8Array(body.byteLength)
		bytes.set(body)
		init.body = bytes
	}
	return new Request(url, init)
}

/** Write a Web `Response` back to a Node `ServerResponse`. */
async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
	res.statusCode = response.status
	response.headers.forEach((value, key) => {
		res.setHeader(key, value)
	})
	const buffer = Buffer.from(await response.arrayBuffer())
	res.end(buffer)
}

/**
 * Register the local-mode admin middleware on the Vite dev server. The caller
 * must only invoke this in `local` mode — in `hosted` mode the managed sandbox
 * sidecar + the webmaster tab own these responsibilities, so the plugin never
 * registers this middleware (verified by the no-op test).
 */
export function createLocalAdminMiddleware(server: AdminViteServerLike, options: LocalAdminOptions): void {
	const peerLoader = options.peerLoader ?? defaultAdminPeerLoader
	const getSidecar = makeLazySidecar(options, peerLoader)
	const shell = adminShellHtml(options.entryModuleId, ADMIN_API_BASE)

	// 1. In-process sidecar API. Strip the local mount prefix and forward the rest
	//    (which begins with `/cms/v1/...`) to the sidecar's Web `fetch` handler.
	server.middlewares.use((req, res, next) => {
		const rawUrl = req.url ?? ''
		if (!rawUrl.startsWith(`${ADMIN_API_PREFIX}/`) && rawUrl !== ADMIN_API_PREFIX) {
			next()
			return
		}
		const forwardedPath = rawUrl.slice(ADMIN_API_PREFIX.length) || '/'

		readBody(req, options.maxUploadSize)
			.then(async (body) => {
				const sidecar = await getSidecar()
				if (sidecar === null) {
					// Optional peer not installed — degrade gracefully (cms-headless F6).
					res.statusCode = 501
					res.setHeader('content-type', 'application/json; charset=utf-8')
					res.end(JSON.stringify({ error: ADMIN_PEERS_MISSING_MESSAGE, code: 'unsupported' }))
					return
				}
				const request = toWebRequest(req, forwardedPath, body)
				const response = await sidecar.fetch(request)
				await writeWebResponse(res, response)
			})
			.catch((error) => {
				console.error('[nua-cms] /_nua/admin API error:', error)
				if (!res.headersSent) {
					res.statusCode = 500
					res.setHeader('content-type', 'application/json; charset=utf-8')
				}
				res.end(JSON.stringify({ error: 'Internal server error', code: 'io_error' }))
			})
	})

	// 2. Admin SPA shell at /_nua/admin (and any sub-path under it — the SPA owns
	//    its own internal view-state navigation). Health-check the in-process
	//    sidecar before serving so a broken project surfaces a clear error rather
	//    than a blank SPA. The HTML is run through Vite's transform so the dev
	//    client + the virtual entry module resolve and HMR works.
	server.middlewares.use((req, res, next) => {
		const pathname = (req.url ?? '').split('?')[0] ?? ''
		const isAdmin = pathname === ADMIN_ROUTE || pathname.startsWith(`${ADMIN_ROUTE}/`)
		if (!isAdmin || (req.method !== 'GET' && req.method !== 'HEAD')) {
			next()
			return
		}

		const serve = async () => {
			const sidecar = await getSidecar()
			// Optional peers not installed — serve a clear placeholder rather than a
			// blank/erroring SPA (cms-headless F6). Both halves of the pair are needed:
			// the sidecar (API brain) and collections-admin (the SPA the shell mounts).
			if (sidecar === null || !(await peerLoader.isCollectionsAdminInstalled())) {
				res.statusCode = 501
				res.setHeader('content-type', 'text/plain; charset=utf-8')
				res.end(ADMIN_PEERS_MISSING_MESSAGE)
				return
			}
			const health = await sidecar.fetch(new Request('http://localhost/health'))
			if (!health.ok) {
				res.statusCode = 503
				res.setHeader('content-type', 'text/plain; charset=utf-8')
				res.end('Nua CMS local sidecar is not healthy.')
				return
			}
			const html = await server.transformIndexHtml(pathname, shell)
			res.statusCode = 200
			res.setHeader('content-type', 'text/html; charset=utf-8')
			res.setHeader('cache-control', 'no-store')
			res.end(html)
		}

		serve().catch((error) => {
			console.error('[nua-cms] /_nua/admin serve error:', error)
			if (!res.headersSent) {
				res.statusCode = 500
				res.setHeader('content-type', 'text/plain; charset=utf-8')
			}
			res.end('Failed to load Nua CMS admin.')
		})
	})
}
