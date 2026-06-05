/**
 * Ambient globals for the local `/_nua/admin` SPA entry (cms-headless F7).
 *
 * The dev middleware injects the cms-sidecar `apiBase` into the HTML shell as a
 * window global; the entry reads it to drive `<CollectionsAdminApp apiBase={…} />`.
 */

declare global {
	interface Window {
		/** Base URL the in-process cms-sidecar is mounted at (the SPA adds nothing else; it is already the `/cms/v1` base). */
		__NUA_ADMIN_API_BASE__?: string
	}
}

export {}
