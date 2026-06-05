import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { resetProjectRoot, setProjectRoot } from '../../src/config'
import {
	ADMIN_API_BASE,
	ADMIN_API_PREFIX,
	ADMIN_PEERS_MISSING_MESSAGE,
	ADMIN_ROUTE,
	type AdminPeerLoader,
	type AdminViteServerLike,
	createLocalAdminMiddleware,
	type LocalAdminOptions,
} from '../../src/local-admin'
import { cleanupTempDir, createTempDir, type TempDirContext } from '../utils/temp-directory'

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void

/** Narrow `unknown` to a record so property reads typecheck without casts. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/** Read a collection's `name` from an unknown list item without a cast. */
function collectionName(value: unknown): unknown {
	return isRecord(value) ? value.name : undefined
}

/**
 * Mock Vite dev-server that records the middlewares the admin module registers and
 * exposes a `transformIndexHtml` spy. The recorded middlewares are then run as the
 * handler of a real `node:http` server so we exercise the true Node req/res ↔ Web
 * Request/Response bridge end-to-end (no casts, real streams).
 */
function createMockViteServer(): { server: AdminViteServerLike; middlewares: Middleware[]; transformCalls: string[] } {
	const middlewares: Middleware[] = []
	const transformCalls: string[] = []
	const server: AdminViteServerLike = {
		middlewares: {
			use(mw) {
				middlewares.push(mw)
			},
		},
		async transformIndexHtml(url, html) {
			transformCalls.push(url)
			// Stand in for Vite's transform: mark the HTML so the test can assert it ran.
			return html.replace('</head>', '<!-- vite-transformed --></head>')
		},
	}
	return { server, middlewares, transformCalls }
}

/** Run the recorded middleware chain as a real HTTP server; returns a base URL. */
function serveMiddlewares(middlewares: Middleware[]): { server: Server; baseUrl: Promise<string> } {
	const handler = (req: IncomingMessage, res: ServerResponse) => {
		let i = 0
		const next = () => {
			const mw = middlewares[i++]
			if (!mw) {
				// No middleware handled it — emulate a passthrough 404.
				res.statusCode = 404
				res.end('not handled')
				return
			}
			mw(req, res, next)
		}
		next()
	}
	const server = createHttpServer(handler)
	const baseUrl = new Promise<string>((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			// `address()` is `AddressInfo | string | null`; narrow to the object form
			// (a bound TCP socket) and read its numeric port without a cast.
			const address = server.address()
			const port = address !== null && typeof address === 'object' && typeof address.port === 'number' ? address.port : 0
			resolve(`http://127.0.0.1:${port}`)
		})
	})
	return { server, baseUrl }
}

const localOptions = (entryModuleId: string): LocalAdminOptions => ({
	contentDir: 'src/content',
	componentDirs: ['src/components'],
	maxUploadSize: 10 * 1024 * 1024,
	entryModuleId,
})

describe('local-admin middleware (cms-headless F7)', () => {
	let ctx: TempDirContext
	let httpServer: Server | undefined

	beforeEach(async () => {
		ctx = await createTempDir('local-admin-')
		// A tiny project with one content collection so the in-process sidecar has
		// something to scan via createCmsCore(createNodeFs(root)).
		await ctx.mkdir('src/content/blog')
		await ctx.writeFile(
			'src/content/blog/hello.md',
			'---\ntitle: Hello World\n---\n\nBody.\n',
		)
		// The sidecar reads the project through getProjectRoot(); pin it to the temp dir.
		setProjectRoot(ctx.tempDir)
	})

	afterEach(async () => {
		if (httpServer) {
			await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
			httpServer = undefined
		}
		resetProjectRoot()
		await cleanupTempDir(ctx)
	})

	test('registers exactly two middlewares (API mount + admin shell)', () => {
		const { server, middlewares } = createMockViteServer()
		createLocalAdminMiddleware(server, localOptions('/@nuasite/cms-admin-entry.js'))
		expect(middlewares.length).toBe(2)
	})

	test('serves the collections-admin SPA shell at /_nua/admin with the injected apiBase', async () => {
		const entryId = '/@nuasite/cms-admin-entry.js'
		const { server, middlewares, transformCalls } = createMockViteServer()
		createLocalAdminMiddleware(server, localOptions(entryId))

		const served = serveMiddlewares(middlewares)
		httpServer = served.server
		const baseUrl = await served.baseUrl

		const response = await fetch(`${baseUrl}${ADMIN_ROUTE}`)
		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toContain('text/html')
		const html = await response.text()

		// The shell loads the virtual entry module and injects the sidecar apiBase as
		// a window global; the SPA is reused verbatim (only apiBase differs from WM).
		expect(html).toContain('id="nua-admin-root"')
		expect(html).toContain(entryId)
		expect(html).toContain(`window.__NUA_ADMIN_API_BASE__ = ${JSON.stringify(ADMIN_API_BASE)}`)
		// Health-checked + run through Vite's transform before serving.
		expect(html).toContain('<!-- vite-transformed -->')
		expect(transformCalls).toContain(ADMIN_ROUTE)
	})

	test('forwards /_nua/cms-admin-api/cms/v1/collections to the in-process sidecar', async () => {
		const { server, middlewares } = createMockViteServer()
		createLocalAdminMiddleware(server, localOptions('/@nuasite/cms-admin-entry.js'))

		const served = serveMiddlewares(middlewares)
		httpServer = served.server
		const baseUrl = await served.baseUrl

		const response = await fetch(`${baseUrl}${ADMIN_API_PREFIX}/cms/v1/collections`)
		expect(response.status).toBe(200)
		const body: unknown = await response.json()
		expect(Array.isArray(body)).toBe(true)
		const names = Array.isArray(body) ? body.map(collectionName) : []
		expect(names).toContain('blog')
	})

	test('forwards the unversioned /health probe to the sidecar', async () => {
		const { server, middlewares } = createMockViteServer()
		createLocalAdminMiddleware(server, localOptions('/@nuasite/cms-admin-entry.js'))

		const served = serveMiddlewares(middlewares)
		httpServer = served.server
		const baseUrl = await served.baseUrl

		const response = await fetch(`${baseUrl}${ADMIN_API_PREFIX}/health`)
		expect(response.status).toBe(200)
		const body: unknown = await response.json()
		expect(isRecord(body) && body.ok === true).toBe(true)
	})

	test('passes through unrelated paths (does not hijack the dev server)', async () => {
		const { server, middlewares } = createMockViteServer()
		createLocalAdminMiddleware(server, localOptions('/@nuasite/cms-admin-entry.js'))

		const served = serveMiddlewares(middlewares)
		httpServer = served.server
		const baseUrl = await served.baseUrl

		// Neither an admin route nor the API mount — both middlewares must call next(),
		// so our test harness returns its passthrough 404 rather than admin HTML.
		const response = await fetch(`${baseUrl}/about`)
		expect(response.status).toBe(404)
		expect(await response.text()).toBe('not handled')
	})
})

/**
 * cms-headless F6: `@nuasite/cms-sidecar` + `@nuasite/collections-admin` are optional
 * peers, loaded lazily via dynamic `import()`. When a slim generated site does not
 * install them, local mode must degrade gracefully (a clear 501 placeholder) instead
 * of crashing `pletivo dev` or breaking the marker pipeline. The injected
 * `AdminPeerLoader` simulates "peers absent" without uninstalling them.
 */
describe('local-admin degrades gracefully when the optional peers are absent (cms-headless F6)', () => {
	/** A loader standing in for "neither optional peer is installed". */
	const absentPeerLoader: AdminPeerLoader = {
		async loadCreateSidecar() {
			return null
		},
		async isCollectionsAdminInstalled() {
			return false
		},
	}

	const optionsWithLoader = (loader: AdminPeerLoader): LocalAdminOptions => ({
		contentDir: 'src/content',
		componentDirs: ['src/components'],
		maxUploadSize: 10 * 1024 * 1024,
		entryModuleId: '/@nuasite/cms-admin-entry.js',
		peerLoader: loader,
	})

	let httpServer: Server | undefined
	afterEach(async () => {
		if (httpServer) {
			await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
			httpServer = undefined
		}
	})

	test('still registers exactly two middlewares — the plugin/marker pipeline is unaffected', () => {
		const { server, middlewares } = createMockViteServer()
		createLocalAdminMiddleware(server, optionsWithLoader(absentPeerLoader))
		expect(middlewares.length).toBe(2)
	})

	test('/_nua/admin serves a 501 placeholder with a clear install message (no crash)', async () => {
		const { server, middlewares } = createMockViteServer()
		createLocalAdminMiddleware(server, optionsWithLoader(absentPeerLoader))

		const served = serveMiddlewares(middlewares)
		httpServer = served.server
		const baseUrl = await served.baseUrl

		const response = await fetch(`${baseUrl}${ADMIN_ROUTE}`)
		expect(response.status).toBe(501)
		expect(response.headers.get('content-type')).toContain('text/plain')
		expect(await response.text()).toBe(ADMIN_PEERS_MISSING_MESSAGE)
	})

	test('the admin API mount returns a 501 JSON error instead of throwing', async () => {
		const { server, middlewares } = createMockViteServer()
		createLocalAdminMiddleware(server, optionsWithLoader(absentPeerLoader))

		const served = serveMiddlewares(middlewares)
		httpServer = served.server
		const baseUrl = await served.baseUrl

		const response = await fetch(`${baseUrl}${ADMIN_API_PREFIX}/cms/v1/collections`)
		expect(response.status).toBe(501)
		const body: unknown = await response.json()
		expect(isRecord(body) && body.code === 'unsupported').toBe(true)
		expect(isRecord(body) && body.error === ADMIN_PEERS_MISSING_MESSAGE).toBe(true)
	})

	test('the optional peers are never loaded until the first /_nua/admin (or API) hit', () => {
		// Registration alone must not touch the loader — the peers load lazily, so a
		// `pletivo dev` that never opens the admin never imports them.
		let loaderTouched = false
		const trackingLoader: AdminPeerLoader = {
			async loadCreateSidecar() {
				loaderTouched = true
				return null
			},
			async isCollectionsAdminInstalled() {
				loaderTouched = true
				return false
			},
		}
		const { server } = createMockViteServer()
		createLocalAdminMiddleware(server, optionsWithLoader(trackingLoader))
		expect(loaderTouched).toBe(false)
	})
})
