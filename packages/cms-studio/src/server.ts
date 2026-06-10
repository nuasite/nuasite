/**
 * The cms-studio request router.
 *
 * cms-studio is the standalone, batteries-included composition of the headless
 * pieces: it serves the `@nuasite/cms-sidecar` `/cms/v1` API *and* a prebuilt
 * `@nuasite/collections-admin` SPA from the same origin, over the project the CLI
 * was launched in. Same-origin is the whole point — the admin, the API and the
 * project's `public/` assets (including `local`-adapter `/uploads/…`) all share a
 * host, so media previews load and there is no CORS to configure.
 *
 * This module is the pure routing layer; the CLI wires the in-process sidecar and
 * resolves the on-disk directories. Keeping it a plain `fetch` handler makes it
 * drivable directly in a test, exactly like the sidecar's `createServer`.
 */
import type { CmsSidecarServer } from '@nuasite/cms-sidecar'
import path from 'node:path'

export interface StudioServerOptions {
	/** In-process cms-sidecar — answers `/cms/v1/*` and `/health`. */
	sidecar: CmsSidecarServer
	/** Absolute path to the prebuilt SPA (the package's `dist/spa`). */
	spaDir: string
	/** Absolute path to the project's `public/` dir, served for `/uploads/…` etc. Omit to disable. */
	publicDir?: string
}

export interface StudioServer {
	fetch(req: Request): Promise<Response>
}

/** Requests the in-process sidecar owns. Everything else is UI / static. */
function isApiPath(pathname: string): boolean {
	return pathname === '/health' || pathname === '/cms/v1' || pathname.startsWith('/cms/v1/')
}

/**
 * Resolve a URL path inside `dir`, rejecting traversal. Returns the absolute file
 * path, or `null` when the request escapes the directory (`..`).
 */
function safeResolve(dir: string, pathname: string): string | null {
	const decoded = decodeURIComponent(pathname)
	const rel = decoded.startsWith('/') ? decoded.slice(1) : decoded
	const resolved = path.resolve(dir, rel)
	if (resolved !== dir && !resolved.startsWith(dir + path.sep)) return null
	return resolved
}

/** Serve a static file from `dir` if it exists and is inside `dir`; else `null`. */
async function serveStatic(dir: string, pathname: string): Promise<Response | null> {
	const resolved = safeResolve(dir, pathname)
	if (resolved === null) return null
	const file = Bun.file(resolved)
	if (!(await file.exists())) return null
	return new Response(file)
}

export function createStudioServer(opts: StudioServerOptions): StudioServer {
	const { sidecar, spaDir, publicDir } = opts
	const indexHtmlPath = path.join(spaDir, 'index.html')

	return {
		async fetch(req: Request): Promise<Response> {
			const { pathname } = new URL(req.url)

			// 1. The API + health belong to the sidecar (any verb).
			if (isApiPath(pathname)) return sidecar.fetch(req)

			// Past this point everything is a static GET/HEAD; other verbs are an API
			// call that did not match a sidecar route.
			if (req.method !== 'GET' && req.method !== 'HEAD') {
				return new Response('Method Not Allowed', { status: 405 })
			}

			// 2. Prebuilt SPA assets (Vite emits `/assets/…`; the shell is `/index.html`).
			const spaHit = await serveStatic(spaDir, pathname === '/' ? '/index.html' : pathname)
			if (spaHit) return spaHit

			// 3. Project public assets (e.g. the local media adapter's `/uploads/…`).
			if (publicDir !== undefined) {
				const pub = await serveStatic(publicDir, pathname)
				if (pub) return pub
			}

			// 4. Unknown path → the SPA shell, so client-side routing can take over.
			const index = Bun.file(indexHtmlPath)
			if (await index.exists()) {
				return new Response(index, { headers: { 'content-type': 'text/html; charset=utf-8' } })
			}
			return new Response(
				'cms-studio: the admin bundle (dist/spa) is missing — run `bun run build` in @nuasite/cms-studio.',
				{ status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
			)
		},
	}
}
