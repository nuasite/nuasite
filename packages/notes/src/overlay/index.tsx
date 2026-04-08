/** @jsxImportSource preact */
import { render } from 'preact'
import { App } from './App'
import { enableCmsBridge } from './lib/cms-bridge'
import { isReviewMode, setReviewModeCookie } from './lib/url-mode'
import OVERLAY_STYLES from './styles.css?inline'

/**
 * Notes overlay entry. Loaded as a virtual ESM module from the page bundle.
 *
 * - If the URL flag is absent and the cookie isn't set, do nothing. CMS works
 *   as normal and the overlay never mounts.
 * - Otherwise, persist the cookie so navigation stays in review mode, hide
 *   the CMS chrome via the bridge stylesheet, and mount the Preact app
 *   inside a shadow DOM so our CSS doesn't leak into the host page.
 *
 * The build-time URL flag is read from `window.__NuaNotesConfig` which the
 * Astro integration injects in `astro:config:setup` before this module loads.
 */

interface NuaNotesConfig {
	urlFlag?: string
	agencyFlag?: string
}

declare global {
	interface Window {
		__NuaNotesConfig?: NuaNotesConfig
		__nuasiteNotesMounted?: boolean
	}
}

function init(): void {
	if (window.__nuasiteNotesMounted) return

	const config = window.__NuaNotesConfig ?? {}
	const urlFlag = config.urlFlag ?? 'nua-notes'
	const agencyFlag = config.agencyFlag ?? 'nua-agency'

	if (!isReviewMode(urlFlag)) return
	window.__nuasiteNotesMounted = true

	// Cement the cookie so subsequent navigation keeps review mode without
	// re-appending `?nua-notes` to every link.
	setReviewModeCookie()
	enableCmsBridge()

	const host = document.createElement('div')
	host.id = 'nua-notes-host'
	host.setAttribute('data-nua-notes-host', '')
	host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483600;'
	document.body.appendChild(host)

	const shadow = host.attachShadow({ mode: 'open' })

	const styleEl = document.createElement('style')
	styleEl.textContent = OVERLAY_STYLES
	shadow.appendChild(styleEl)

	const root = document.createElement('div')
	root.id = 'nua-notes-root'
	shadow.appendChild(root)

	render(<App urlFlag={urlFlag} agencyFlag={agencyFlag} />, root)
}

if (typeof window !== 'undefined') {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, { once: true })
	} else {
		init()
	}
}
