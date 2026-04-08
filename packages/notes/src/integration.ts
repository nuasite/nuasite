import type { AstroIntegration } from 'astro'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNotesDevMiddleware } from './dev/middleware'
import { NotesJsonStore } from './storage/json-store'
import type { NuaNotesOptions } from './types'

/**
 * `@nuasite/notes` Astro integration.
 *
 * Adds a Pastel-style comment overlay (Phase 2) and a Google Docs-style
 * suggestion overlay (Phase 3+) alongside `@nuasite/cms`. Activated by
 * visiting any page with the `?nua-notes` query flag (or with the
 * `nua-notes-mode=1` cookie set).
 *
 * What ships in each phase:
 *   Phase 0: marker script proves the integration mounts
 *   Phase 1: dev API + JSON storage at /_nua/notes/*
 *   Phase 2: Preact overlay v1 — sidebar, comment popover, mode toggle
 *   Phase 3: range suggestions with diff preview
 *   Phase 4: apply flow (peer-imports @nuasite/cms source-finder)
 *   Phase 5: proxy support, replies, agency inbox
 */

const VIRTUAL_OVERLAY_PATH = '/@nuasite/notes-overlay.js'

export default function nuaNotes(options: NuaNotesOptions = {}): AstroIntegration {
	const {
		enabled = true,
		urlFlag = 'nua-notes',
		notesDir = 'data/notes',
	} = options

	// Lazily constructed in `astro:config:setup` once we know the project root.
	let store: NotesJsonStore | null = null
	let projectRoot: string | null = null

	return {
		name: '@nuasite/notes',
		hooks: {
			'astro:config:setup': ({ command, config, injectScript, updateConfig, logger }) => {
				// Notes is dev-only, mirroring @nuasite/cms.
				if (command !== 'dev') return
				if (!enabled) {
					logger.info('@nuasite/notes is disabled via options.enabled')
					return
				}

				// Astro provides the project root as a file:// URL on `config.root`.
				projectRoot = fileURLToPath(config.root)
				store = new NotesJsonStore({ projectRoot, notesDir })

				// Resolve the overlay source file inside this package so the virtual
				// module can map to it without a hard-coded path. Mirrors how
				// @nuasite/cms resolves its editor entry.
				const notesDirAbs = dirname(fileURLToPath(import.meta.url))
				const overlayEntry = join(notesDirAbs, 'overlay/index.tsx')

				// Inject a small loader on every page. It writes the runtime config
				// (window.__NuaNotesConfig) and adds the overlay script tag once.
				// The overlay itself decides at runtime whether to mount based on
				// the URL flag / cookie, so the cost on non-review pages is a tiny
				// idempotent script tag.
				injectScript(
					'page',
					`
					(function () {
						if (window.__nuasiteNotesAlive) return;
						window.__nuasiteNotesAlive = true;
						window.__NuaNotesConfig = ${JSON.stringify({ urlFlag })};
						if (!document.querySelector('script[data-nuasite-notes]')) {
							const s = document.createElement('script');
							s.type = 'module';
							s.src = ${JSON.stringify(VIRTUAL_OVERLAY_PATH)};
							s.dataset.nuasiteNotes = '';
							document.head.appendChild(s);
						}
					})();
					`,
				)

				// Vite plugins:
				//   1. Resolve the virtual overlay path to the real .tsx file.
				//   2. Prepend the @jsxImportSource pragma to overlay sources so
				//      Vite's esbuild compiles JSX with Preact's `h` instead of
				//      React (which the host project may use).
				const vitePlugins: any[] = [
					{
						name: 'nuasite-notes-overlay-resolver',
						resolveId(id: string) {
							if (id === VIRTUAL_OVERLAY_PATH) return overlayEntry
						},
					},
					{
						name: 'nuasite-notes-preact-jsx',
						transform(code: string, id: string) {
							if (id.includes('/notes/src/overlay/') && id.endsWith('.tsx') && !code.includes('@jsxImportSource')) {
								return `/** @jsxImportSource preact */\n${code}`
							}
						},
					},
				]

				updateConfig({
					vite: {
						plugins: vitePlugins,
						resolve: {
							alias: {
								'react': 'preact/compat',
								'react-dom': 'preact/compat',
								'react/jsx-runtime': 'preact/jsx-runtime',
							},
						},
					},
				})

				logger.info(`@nuasite/notes injected (notesDir: ${notesDir})`)
			},

			'astro:server:setup': ({ server, logger }) => {
				if (!enabled) return
				if (!store || !projectRoot) {
					logger.warn('@nuasite/notes server:setup ran before config:setup; skipping')
					return
				}
				createNotesDevMiddleware(server, store, projectRoot)
				logger.info('@nuasite/notes API enabled at /_nua/notes/')
			},
		},
	}
}

export { nuaNotes }
