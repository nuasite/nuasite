/**
 * URL flag + cookie helpers controlling notes review mode.
 *
 * Review mode is on when EITHER the URL has the `?<urlFlag>` query param OR
 * the `nua-notes-mode=1` cookie is set. Visiting a page with the flag the
 * first time sets the cookie so subsequent navigation stays in review mode.
 *
 * The toggle button in the toolbar clears the cookie + reloads, which drops
 * the user back into the regular CMS view.
 */

const COOKIE = 'nua-notes-mode'

export function isReviewMode(urlFlag: string): boolean {
	if (typeof window === 'undefined') return false
	const url = new URL(window.location.href)
	if (url.searchParams.has(urlFlag)) return true
	return document.cookie.split('; ').some(c => c.startsWith(`${COOKIE}=1`))
}

export function setReviewModeCookie(): void {
	// Session cookie — cleared when the browser closes. Good enough for v0.1.
	document.cookie = `${COOKIE}=1; path=/; SameSite=Lax`
}

export function clearReviewModeCookie(): void {
	document.cookie = `${COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
}

export function exitReviewMode(urlFlag: string): void {
	clearReviewModeCookie()
	const url = new URL(window.location.href)
	url.searchParams.delete(urlFlag)
	window.location.href = url.pathname + (url.search || '') + url.hash
}

export function getCurrentPagePath(): string {
	if (typeof window === 'undefined') return '/'
	const p = window.location.pathname
	if (p === '' || p === '/') return '/'
	// Drop trailing slash for consistency with CMS / notes storage
	return p.endsWith('/') ? p.slice(0, -1) : p
}
