import type { AstroIntegration } from 'astro'
import { createNotesDevMiddleware } from './dev/middleware'
import { NotesJsonStore } from './storage/json-store'
import type { NuaNotesOptions } from './types'

/**
 * `@nuasite/notes` Astro integration.
 *
 * Adds a Pastel-style comment overlay and a Google Docs-style suggestion
 * overlay alongside `@nuasite/cms`. Activated by visiting any page with
 * the `?nua-notes` query flag (or with the `nua-notes-mode=1` cookie set).
 *
 * Phase 0 injected a console marker. Phase 1 (this commit) adds:
 *   - A JSON store under `<notesDir>/pages/<slug>.json`
 *   - The dev API at `/_nua/notes/*` (list/create/update/resolve/delete/apply)
 *
 * Phases 2+ add the Preact overlay bundle, range suggestions, and the
 * apply flow that peer-imports `@nuasite/cms` source-finder utilities.
 */
export default function nuaNotes(options: NuaNotesOptions = {}): AstroIntegration {
	const {
		enabled = true,
		urlFlag = 'nua-notes',
		notesDir = 'data/notes',
	} = options

	// Lazily constructed in `astro:config:setup` once we know the project root.
	let store: NotesJsonStore | null = null

	return {
		name: '@nuasite/notes',
		hooks: {
			'astro:config:setup': ({ command, config, injectScript, logger }) => {
				// Notes is dev-only, mirroring @nuasite/cms.
				if (command !== 'dev') return
				if (!enabled) {
					logger.info('@nuasite/notes is disabled via options.enabled')
					return
				}

				// Astro provides the project root as a file:// URL on `config.root`.
				const projectRoot = new URL(config.root).pathname
				store = new NotesJsonStore({ projectRoot, notesDir })

				// Phase 0 marker: prove the script reaches the page without
				// fighting @nuasite/cms over click handlers, z-index, or focus.
				// Replaced by the Preact overlay bundle in Phase 2.
				injectScript(
					'page',
					`
					(function () {
						if (window.__nuasiteNotesAlive) return;
						window.__nuasiteNotesAlive = true;
						const url = new URL(window.location.href);
						const reviewMode = url.searchParams.has(${JSON.stringify(urlFlag)})
							|| document.cookie.includes('nua-notes-mode=1');
						console.log(
							'%c[nuasite-notes]%c alive %c' + (reviewMode ? '(review mode)' : '(idle)'),
							'background:#1f2937;color:#fbbf24;padding:2px 6px;border-radius:2px;font-weight:600;',
							'color:inherit;',
							'color:#9ca3af;font-style:italic;',
						);
					})();
					`,
				)

				logger.info(`@nuasite/notes injected (notesDir: ${notesDir})`)
			},

			'astro:server:setup': ({ server, logger }) => {
				if (!enabled) return
				if (!store) {
					// Should not happen — config:setup runs first — but be defensive.
					logger.warn('@nuasite/notes server:setup ran before config:setup; skipping')
					return
				}
				createNotesDevMiddleware(server, store)
				logger.info('@nuasite/notes API enabled at /_nua/notes/')
			},
		},
	}
}

export { nuaNotes }
