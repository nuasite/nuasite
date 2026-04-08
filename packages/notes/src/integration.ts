import type { AstroIntegration } from 'astro'
import { existsSync, readFileSync } from 'node:fs'
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

				// Two delivery modes for the overlay (mirrors @nuasite/cms):
				//
				//  1. NPM install case: a pre-built `dist/overlay.js` ships with
				//     the package and is served as the virtual module. The bundle
				//     has preact, the overlay sources, and the inlined CSS — the
				//     consumer needs zero peer dependencies.
				//
				//  2. Monorepo dev case (this repo's playground): no pre-built
				//     bundle exists, so we resolve the virtual module to the
				//     source `overlay/index.tsx` and let Vite compile it on the
				//     fly using the JSX-pragma transform plugin below. preact is
				//     resolved through the workspace devDependency.
				const notesDirAbs = dirname(fileURLToPath(import.meta.url))
				const overlayBundlePath = join(notesDirAbs, '../dist/overlay.js')
				const hasPrebuiltBundle = existsSync(overlayBundlePath)
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
				//   - In bundle mode: serve the pre-built overlay.js as the
				//     virtual module via a load() hook. No source compilation
				//     needed and the consumer doesn't need preact installed.
				//   - In source mode (monorepo dev): resolve the virtual path to
				//     the real .tsx file AND prepend the @jsxImportSource pragma
				//     so Vite's esbuild compiles JSX with Preact's `h` instead
				//     of React (which the host project may use).
				const vitePlugins: any[] = []

				if (hasPrebuiltBundle) {
					const bundleContent = readFileSync(overlayBundlePath, 'utf-8')
					vitePlugins.push({
						name: 'nuasite-notes-overlay-bundle',
						resolveId(id: string) {
							if (id === VIRTUAL_OVERLAY_PATH) return VIRTUAL_OVERLAY_PATH
						},
						load(id: string) {
							if (id === VIRTUAL_OVERLAY_PATH) return bundleContent
						},
					})
				} else {
					vitePlugins.push(
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
					)
				}

				// Only force the react→preact alias in source mode. In bundle
				// mode, preact is already inlined in the bundle and the alias
				// could conflict with consumer apps that legitimately use React.
				updateConfig({
					vite: {
						plugins: vitePlugins,
						resolve: hasPrebuiltBundle ? undefined : {
							alias: {
								'react': 'preact/compat',
								'react-dom': 'preact/compat',
								'react/jsx-runtime': 'preact/jsx-runtime',
							},
						},
					},
				})

				logger.info(
					`@nuasite/notes injected (notesDir: ${notesDir}, ${hasPrebuiltBundle ? 'pre-built overlay' : 'source overlay'})`,
				)
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
