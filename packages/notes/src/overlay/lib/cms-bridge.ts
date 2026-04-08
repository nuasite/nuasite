/**
 * Host-page bridge: hide CMS chrome and reserve space for the notes UI.
 *
 * Two responsibilities, both implemented as a single injected `<style>` tag
 * in the host document so the page can be returned to its original layout
 * by simply removing the tag.
 *
 *   1. Hide CMS chrome (`#cms-app-host`, `[data-nuasite-cms]`) so we have
 *      mode exclusivity with `@nuasite/cms`.
 *   2. Reserve space for the notes toolbar (40px top) and sidebar (340px
 *      right) by padding the body. Without this the fixed-position notes UI
 *      sits on top of page content and the rightmost 340px of every page is
 *      unreachable. The padding is toggled by a `data-nua-notes-collapsed`
 *      attribute on `<html>` — when collapsed, only the toolbar gap stays.
 *
 * Note on `box-sizing: border-box` on `body`: most sites already inherit it
 * via a global reset, but we set it explicitly so the math works regardless.
 * The padding cuts into the body's box rather than expanding the page width
 * past 100vw, which would create a horizontal scrollbar.
 */

const STYLE_ID = 'nua-notes-cms-bridge'
const COLLAPSE_ATTR = 'data-nua-notes-collapsed'

const STYLES = `
	#cms-app-host { display: none !important; }
	[data-nuasite-cms] { display: none !important; }

	/* Reserve space for the notes toolbar + sidebar so they don't sit on top
	 * of host page content. Padding the body lets the page reflow into the
	 * visible area instead of being clipped under fixed-position chrome. */
	html:not([${COLLAPSE_ATTR}]) body {
		box-sizing: border-box;
		padding-top: 40px !important;
		padding-right: 340px !important;
	}

	/* When the sidebar is collapsed, only reserve the toolbar height. */
	html[${COLLAPSE_ATTR}] body {
		box-sizing: border-box;
		padding-top: 40px !important;
	}

	/* Page-fixed elements (sticky headers, fixed nav) don't get pushed by
	 * body padding because they're positioned against the viewport. Offset
	 * them via top/right so they slot into the same chrome-free area. We
	 * scope this to elements the host page declared as fixed/sticky to
	 * avoid touching the notes UI itself (which lives in a shadow DOM). */
	html:not([${COLLAPSE_ATTR}]) body > header[class*="fixed"],
	html:not([${COLLAPSE_ATTR}]) body > nav[class*="fixed"],
	html:not([${COLLAPSE_ATTR}]) body > [class*="sticky"] {
		right: 340px !important;
	}
`

export function enableCmsBridge(): void {
	if (document.getElementById(STYLE_ID)) return
	const style = document.createElement('style')
	style.id = STYLE_ID
	style.textContent = STYLES
	document.head.appendChild(style)
}

export function disableCmsBridge(): void {
	const existing = document.getElementById(STYLE_ID)
	if (existing) existing.remove()
	document.documentElement.removeAttribute(COLLAPSE_ATTR)
}

/** Toggle sidebar-collapsed mode. The toolbar stays visible, the sidebar
 *  slides off, and the body's right padding is removed so page content can
 *  use the full viewport width. */
export function setSidebarCollapsed(collapsed: boolean): void {
	if (collapsed) {
		document.documentElement.setAttribute(COLLAPSE_ATTR, '')
	} else {
		document.documentElement.removeAttribute(COLLAPSE_ATTR)
	}
}

export function isSidebarCollapsed(): boolean {
	return document.documentElement.hasAttribute(COLLAPSE_ATTR)
}
