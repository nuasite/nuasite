/**
 * Local `/_nua/admin` SPA entry (cms-headless F7).
 *
 * Mounts the host-agnostic `@nuasite/collections-admin` SPA into the page served
 * by the local-admin dev middleware. The only host-specific input is `apiBase`,
 * which the HTML shell injects as `window.__NUA_ADMIN_API_BASE__` — it points at
 * the in-process cms-sidecar mounted by the dev middleware (`…/cms/v1`). The same
 * lib backs the webmaster Collections tab; only `apiBase` differs.
 *
 * This file is served as a virtual module through Astro's Vite dev server, so it
 * is transformed (TSX → JS, React resolved) and HMR-capable like any app module.
 */

import { CollectionsAdminApp } from '@nuasite/collections-admin'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

function readApiBase(): string {
	const value = window.__NUA_ADMIN_API_BASE__
	if (typeof value !== 'string' || value === '') {
		throw new Error('[nua-cms] /_nua/admin: window.__NUA_ADMIN_API_BASE__ is not set')
	}
	return value
}

const container = document.getElementById('nua-admin-root')
if (!container) {
	throw new Error('[nua-cms] /_nua/admin: #nua-admin-root container is missing')
}

createRoot(container).render(
	<StrictMode>
		<CollectionsAdminApp apiBase={readApiBase()} />
	</StrictMode>,
)
