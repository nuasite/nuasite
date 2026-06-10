/**
 * The cms-studio SPA entry (a build input, not shipped to runtime).
 *
 * Vite bundles this into `dist/spa/` together with the entire
 * `@nuasite/collections-admin` tree (React, Milkdown, the MDX editor) — no host
 * provides them, so everything is inlined. The studio server serves the bundle
 * on the same origin as the API, so `apiBase` is the fixed same-origin `/cms/v1`
 * (no injection needed, unlike the F7 dev-server shell).
 *
 * Lives in its own `src/spa` tsconfig project (composite:false, noEmit) so the
 * server project (`cli`/`server`) stays free of the React/collections-admin
 * dependency edge — mirroring how `@nuasite/cms` isolates its `src/admin` entry.
 */
import { CollectionsAdminApp } from '@nuasite/collections-admin'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const container = document.getElementById('nua-studio-root')
if (!container) throw new Error('[cms-studio] #nua-studio-root container is missing')

createRoot(container).render(
	<StrictMode>
		<CollectionsAdminApp apiBase="/cms/v1" />
	</StrictMode>,
)
