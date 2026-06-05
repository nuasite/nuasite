import { describe, expect, test } from 'bun:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { type AdminPeerLoader, type AdminViteServerLike, createLocalAdminMiddleware } from '../../src/local-admin'
import { detectHostedFromEnv, resolveCmsMode } from '../../src/mode'

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void

/** Record the middlewares a registrar installs, mirroring the plugin's Vite server. */
function recordingServer(): { server: AdminViteServerLike; middlewares: Middleware[] } {
	const middlewares: Middleware[] = []
	const server: AdminViteServerLike = {
		middlewares: {
			use(mw) {
				middlewares.push(mw)
			},
		},
		async transformIndexHtml(_url, html) {
			return html
		},
	}
	return { server, middlewares }
}

describe('cms mode detection (cms-headless F7)', () => {
	describe('detectHostedFromEnv', () => {
		test('local by default — no sandbox signal in a developer env', () => {
			expect(detectHostedFromEnv({})).toBe(false)
			expect(detectHostedFromEnv({ HOME: '/home/dev', PATH: '/usr/bin' })).toBe(false)
		})

		test('SANDBOX_ID present ⇒ hosted (the agent runtime sets it in the sandbox)', () => {
			expect(detectHostedFromEnv({ SANDBOX_ID: 'prj_123' })).toBe(true)
		})

		test('CMS_SIDECAR_LOCAL_EDVABE=1 ⇒ hosted (local edvabe sandbox variant)', () => {
			expect(detectHostedFromEnv({ CMS_SIDECAR_LOCAL_EDVABE: '1' })).toBe(true)
		})

		test('empty / whitespace-only signal does not count as hosted', () => {
			expect(detectHostedFromEnv({ SANDBOX_ID: '' })).toBe(false)
			expect(detectHostedFromEnv({ SANDBOX_ID: '   ' })).toBe(false)
		})
	})

	describe('resolveCmsMode', () => {
		test('auto: local when no sandbox signal', () => {
			expect(resolveCmsMode(undefined, {})).toBe('local')
		})

		test('auto: hosted when a sandbox signal is present', () => {
			expect(resolveCmsMode(undefined, { SANDBOX_ID: 'prj_123' })).toBe('hosted')
		})

		test('explicit override wins over auto-detection (force hosted in a local env)', () => {
			expect(resolveCmsMode('hosted', {})).toBe('hosted')
		})

		test('explicit override wins over auto-detection (force local inside a sandbox)', () => {
			expect(resolveCmsMode('local', { SANDBOX_ID: 'prj_123' })).toBe('local')
		})
	})

	describe('hosted is a no-op for the local admin (the plugin gates on the mode)', () => {
		// The plugin registers the local admin only when `resolveCmsMode(...) === 'local'`.
		// These tests pin that contract: under a sandbox env the gate is false, so the
		// admin registrar is never invoked (no sidecar spawn, no /_nua/admin route);
		// under a local env it is invoked and installs its middlewares.
		//
		// cms-headless F6: the optional peers (`@nuasite/cms-sidecar` +
		// `@nuasite/collections-admin`) are loaded only by the admin middleware via the
		// injected peer loader. Tracking whether the loader is ever touched proves that
		// hosted mode (where the registrar is never invoked) NEVER imports the peers — so
		// a production/hosted site that does not install them never tries to load them.
		const makeTrackingLoader = () => {
			const state = { touched: false }
			const loader: AdminPeerLoader = {
				async loadCreateSidecar() {
					state.touched = true
					return null
				},
				async isCollectionsAdminInstalled() {
					state.touched = true
					return false
				},
			}
			return { state, loader }
		}

		const registerWhenLocal = (mode: 'local' | 'hosted', server: AdminViteServerLike, peerLoader: AdminPeerLoader) => {
			if (mode === 'local') {
				createLocalAdminMiddleware(server, {
					contentDir: 'src/content',
					componentDirs: ['src/components'],
					maxUploadSize: 1024,
					entryModuleId: '/@nuasite/cms-admin-entry.js',
					peerLoader,
				})
			}
		}

		test('hosted (sandbox env) registers nothing and never loads the optional peers — strict no-op', () => {
			const mode = resolveCmsMode(undefined, { SANDBOX_ID: 'prj_123' })
			expect(mode).toBe('hosted')
			const { server, middlewares } = recordingServer()
			const { state, loader } = makeTrackingLoader()
			registerWhenLocal(mode, server, loader)
			expect(middlewares.length).toBe(0)
			// The peers are never even probed in hosted mode.
			expect(state.touched).toBe(false)
		})

		test('local (no sandbox env) registers the admin middlewares', () => {
			const mode = resolveCmsMode(undefined, {})
			expect(mode).toBe('local')
			const { server, middlewares } = recordingServer()
			const { loader } = makeTrackingLoader()
			registerWhenLocal(mode, server, loader)
			expect(middlewares.length).toBe(2)
		})
	})
})
