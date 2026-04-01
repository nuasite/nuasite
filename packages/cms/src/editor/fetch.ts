import { API } from './constants'

export async function fetchWithTimeout(
	url: string,
	options: RequestInit = {},
	timeoutMs: number = API.REQUEST_TIMEOUT_MS,
): Promise<Response> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

	// If the caller already provided a signal, forward its abort to our controller
	if (options.signal) {
		options.signal.addEventListener('abort', () => controller.abort(), { once: true })
	}

	try {
		return await fetch(url, {
			...options,
			signal: controller.signal,
		})
	} finally {
		clearTimeout(timeoutId)
	}
}

/** POST JSON and return parsed response, or an error object on failure. */
export async function postJson<TRes extends { success: boolean; error?: string }>(
	url: string,
	body: unknown,
	errorContext?: string,
): Promise<TRes> {
	const res = await fetchWithTimeout(url, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})

	if (!res.ok) {
		const text = await res.text().catch(() => '')
		const prefix = errorContext || 'Request failed'
		return { success: false, error: `${prefix} (${res.status}): ${text || res.statusText}` } as TRes
	}

	return res.json()
}

/** GET JSON and return parsed response. Returns fallback on failure. */
export async function getJson<TRes>(
	url: string,
	fallback: TRes,
	signal?: AbortSignal,
): Promise<TRes> {
	const res = await fetchWithTimeout(url, {
		method: 'GET',
		credentials: 'include',
		signal,
	})

	if (!res.ok) return fallback
	return res.json()
}
