import type { MediaStorageAdapter } from '@nuasite/cms-types'

export interface ContemberStorageOptions {
	/** Base URL of the worker API, e.g. 'https://api.example.com' */
	apiBaseUrl: string
	/** Project slug used in the API path */
	projectSlug: string
	/** Session token for authentication (NUA_SITE_SESSION_TOKEN cookie value) */
	sessionToken?: string
}

/**
 * Media storage adapter that proxies to the Contember worker's CMS media endpoints.
 * Uses the existing /cms/:projectSlug/media/* API backed by R2 storage + Contember database.
 *
 * All connection details (`apiBaseUrl`, `projectSlug`, `sessionToken`) are injected
 * by the caller — the adapter never reads `process.env`.
 */
export function createContemberStorageAdapter(options: ContemberStorageOptions): MediaStorageAdapter {
	const { apiBaseUrl, projectSlug, sessionToken } = options
	const base = `${apiBaseUrl.replace(/\/$/, '')}/cms/${projectSlug}/media`

	function headers(): Record<string, string> {
		const h: Record<string, string> = {}
		if (sessionToken) {
			h.Cookie = `NUA_SITE_SESSION_TOKEN=${sessionToken}`
		}
		return h
	}

	return {
		async list(opts) {
			const params = new URLSearchParams()
			if (opts?.limit) params.set('limit', String(opts.limit))
			if (opts?.cursor) params.set('cursor', opts.cursor)

			const url = `${base}/list${params.toString() ? `?${params}` : ''}`
			const res = await fetch(url, {
				method: 'GET',
				headers: headers(),
				credentials: 'include',
			})

			if (!res.ok) {
				throw new Error(`Failed to list media (${res.status}): ${await res.text()}`)
			}

			const data: unknown = await res.json()
			const payload = (data && typeof data === 'object') ? data : {}
			return { items: [], folders: [], hasMore: false, ...payload }
		},

		async upload(file, filename, contentType) {
			const blob = new Blob([new Uint8Array(file)], { type: contentType })
			const formData = new FormData()
			formData.append('file', blob, filename)

			const res = await fetch(`${base}/upload`, {
				method: 'POST',
				headers: headers(),
				body: formData,
				credentials: 'include',
			})

			if (!res.ok) {
				const text = await res.text().catch(() => '')
				return { success: false, error: `Upload failed (${res.status}): ${text}` }
			}

			const data: unknown = await res.json()
			const payload = (data && typeof data === 'object') ? data : {}
			return { success: true, ...payload }
		},

		async delete(id) {
			const res = await fetch(`${base}/${encodeURIComponent(id)}`, {
				method: 'DELETE',
				headers: headers(),
				credentials: 'include',
			})

			if (!res.ok) {
				const text = await res.text().catch(() => '')
				return { success: false, error: `Delete failed (${res.status}): ${text}` }
			}

			return { success: true }
		},
	}
}
