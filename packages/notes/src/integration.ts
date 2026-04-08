import type { AstroIntegration } from 'astro'
import type { NuaNotesOptions } from './types'

/**
 * `@nuasite/notes` Astro integration.
 *
 * Adds a Pastel-style comment overlay and a Google Docs-style suggestion
 * overlay alongside `@nuasite/cms`. Activated by visiting any page with
 * the `?nua-notes` query flag (or with the `nua-notes-mode=1` cookie set).
 *
 * Phase 0 (this commit) only injects a console marker so we can verify the
 * integration is wired into the playground without conflicting with
 * `@nuasite/cms`. Phases 1+ add the dev API, JSON storage, the Preact
 * overlay bundle, range suggestions, and the apply flow.
 */
export default function nuaNotes(options: NuaNotesOptions = {}): AstroIntegration {
	const {
		enabled = true,
		urlFlag = 'nua-notes',
	} = options

	return {
		name: '@nuasite/notes',
		hooks: {
			'astro:config:setup': ({ command, injectScript, logger }) => {
				// Notes is dev-only, mirroring @nuasite/cms.
				if (command !== 'dev') return
				if (!enabled) {
					logger.info('@nuasite/notes is disabled via options.enabled')
					return
				}

				// Phase 0 marker: prove the script reaches the page without
				// fighting @nuasite/cms over click handlers, z-index, or focus.
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

				logger.info('@nuasite/notes injected (phase 0 marker)')
			},
		},
	}
}

export { nuaNotes }
