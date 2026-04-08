/**
 * Vite dev middleware mounting `/_nua/notes/*`.
 *
 * Mirrors the structure of `@nuasite/cms`'s `createDevMiddleware`:
 *   - Filters by URL prefix and short-circuits other requests
 *   - Handles CORS preflight before dispatching
 *   - Catches handler errors and surfaces them as 500 JSON responses
 *   - Triggers a Vite HMR full-reload after content-modifying POSTs so
 *     pages currently open in a browser reflect the new note immediately
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NotesJsonStore } from '../storage/json-store'
import type { NotesApiContext } from './api-handlers'
import { handleNotesApiRoute } from './api-handlers'
import { handleCors, sendError } from './request-utils'

/** Minimal ViteDevServer interface — same shape used by `@nuasite/cms`. */
export interface ViteDevServerLike {
	middlewares: {
		use: (middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void
	}
	ws?: {
		send: (payload: { type: string; path?: string }) => void
	}
}

const ROUTE_PREFIX = '/_nua/notes/'

export function createNotesDevMiddleware(
	server: ViteDevServerLike,
	store: NotesJsonStore,
	projectRoot: string,
): void {
	const ctx: NotesApiContext = { store, projectRoot }

	server.middlewares.use((req, res, next) => {
		const url = req.url ?? ''
		if (!url.startsWith(ROUTE_PREFIX)) {
			next()
			return
		}

		if (handleCors(req, res)) return

		const route = url.replace(ROUTE_PREFIX, '').split('?')[0] ?? ''

		handleNotesApiRoute(route, req, res, ctx)
			.then(() => {
				// Mirror CMS: explicitly trigger full-reload after content-modifying
				// routes. In sandboxed dev environments (E2B etc.) chokidar events
				// may not fire reliably for note JSON files, so we send the HMR
				// event directly. The overlay re-fetches `/list` on reload.
				if (req.method === 'POST' && server.ws) {
					server.ws.send({ type: 'full-reload' })
				}
			})
			.catch((error) => {
				console.error('[nuasite-notes] API error:', error)
				if (!res.headersSent) {
					sendError(res, error instanceof Error ? error.message : 'Internal server error', 500, req)
				}
			})
	})
}
