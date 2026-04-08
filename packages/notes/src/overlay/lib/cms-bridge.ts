/**
 * Mode-exclusivity bridge with `@nuasite/cms`.
 *
 * When notes review mode is active we hide the CMS editor chrome via a
 * single injected `<style>` tag in the host document. CMS uses a shadow DOM
 * mounted on `#cms-app-host`, so hiding that element + suppressing pointer
 * events on the data-cms-id markers is enough to make the two UIs not
 * collide. There's no postMessage handshake yet — Phase 5 may add one.
 *
 * `enable()` is idempotent. `disable()` removes the style if it was added.
 */

const STYLE_ID = 'nua-notes-cms-bridge'

const HIDE_CMS_CSS = `
	#cms-app-host { display: none !important; }
	[data-nuasite-cms] { display: none !important; }
	/* Allow notes to handle clicks on annotated elements without CMS interfering */
	[data-cms-id] { cursor: default !important; }
`

export function enableCmsBridge(): void {
	if (document.getElementById(STYLE_ID)) return
	const style = document.createElement('style')
	style.id = STYLE_ID
	style.textContent = HIDE_CMS_CSS
	document.head.appendChild(style)
}

export function disableCmsBridge(): void {
	const existing = document.getElementById(STYLE_ID)
	if (existing) existing.remove()
}
