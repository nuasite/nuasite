/**
 * URL flag + cookie helpers controlling notes review mode and the active role.
 *
 * Review mode is on when EITHER the URL has the `?<urlFlag>` query param OR
 * the `nua-notes-mode=1` cookie is set. Visiting a page with the flag the
 * first time sets the cookie so subsequent navigation stays in review mode.
 *
 * Agency mode is the same idea with a separate flag/cookie pair: visit
 * `?nua-agency` once and the `nua-notes-role=agency` cookie sticks. The
 * toolbar shows the active role so the agency knows when they have full
 * controls vs the read-only client view.
 */

import type { NoteRole } from '../types'

const MODE_COOKIE = 'nua-notes-mode'
const ROLE_COOKIE = 'nua-notes-role'

function readCookie(name: string): string | null {
	if (typeof document === 'undefined') return null
	for (const part of document.cookie.split('; ')) {
		const eq = part.indexOf('=')
		if (eq < 0) continue
		if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1))
	}
	return null
}

export function isReviewMode(urlFlag: string): boolean {
	if (typeof window === 'undefined') return false
	const url = new URL(window.location.href)
	if (url.searchParams.has(urlFlag)) return true
	return readCookie(MODE_COOKIE) === '1'
}

export function setReviewModeCookie(): void {
	// Session cookie — cleared when the browser closes. Good enough for v0.2.
	document.cookie = `${MODE_COOKIE}=1; path=/; SameSite=Lax`
}

export function clearReviewModeCookie(): void {
	document.cookie = `${MODE_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
}

/**
 * Resolve the active role from the URL flag and the cookie. If `agencyFlag`
 * is present in the URL, agency mode is on AND the cookie gets persisted so
 * subsequent navigation stays in agency. If neither flag nor cookie is set,
 * the role is `client`.
 */
export function resolveRole(agencyFlag: string): NoteRole {
	if (typeof window === 'undefined') return 'client'
	const url = new URL(window.location.href)
	if (url.searchParams.has(agencyFlag)) {
		document.cookie = `${ROLE_COOKIE}=agency; path=/; SameSite=Lax`
		return 'agency'
	}
	return readCookie(ROLE_COOKIE) === 'agency' ? 'agency' : 'client'
}

export function clearRoleCookie(): void {
	document.cookie = `${ROLE_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
}

export function exitReviewMode(urlFlag: string, agencyFlag: string): void {
	clearReviewModeCookie()
	clearRoleCookie()
	const url = new URL(window.location.href)
	url.searchParams.delete(urlFlag)
	url.searchParams.delete(agencyFlag)
	window.location.href = url.pathname + (url.search || '') + url.hash
}

export function getCurrentPagePath(): string {
	if (typeof window === 'undefined') return '/'
	const p = window.location.pathname
	if (p === '' || p === '/') return '/'
	// Drop trailing slash for consistency with CMS / notes storage
	return p.endsWith('/') ? p.slice(0, -1) : p
}
