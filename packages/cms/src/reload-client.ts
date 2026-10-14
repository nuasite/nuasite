export interface ReloadClientOptions {
	/** WebSocket URL, absolute or relative to the page (`/_live`). `http(s):` is turned into `ws(s):`. */
	url: string
	/**
	 * The revision the page was rendered from. A message carrying another revision reloads the
	 * page, and the host may send its current revision on connect, so a page rendered before a
	 * change it missed while disconnected reloads too. Without it, every message reloads.
	 */
	revision?: string
}

/**
 * The browser script that reloads the page when the host reports a change, for hosts without
 * Vite's HMR. Messages are JSON `{ "revision": "…" }` (or anything, without a page revision).
 * Before reloading it dispatches a cancelable `nua:external-change` event on `window`, so a page
 * with unsaved edits can keep itself open.
 */
export function reloadClientScript(options: ReloadClientOptions): string {
	const config = JSON.stringify({ url: options.url, revision: options.revision ?? null })
	return `(() => {
	const config = ${config.replace(/</g, '\\u003c')};
	const url = new URL(config.url, location.href);
	if (url.protocol === 'http:') url.protocol = 'ws:';
	else if (url.protocol === 'https:') url.protocol = 'wss:';
	let delay = 500;
	const changed = (data) => {
		if (config.revision === null) return true;
		try {
			const revision = JSON.parse(data).revision;
			return typeof revision === 'string' && revision !== config.revision;
		} catch {
			return false;
		}
	};
	const connect = () => {
		const socket = new WebSocket(url);
		socket.addEventListener('open', () => { delay = 500; });
		socket.addEventListener('message', (event) => {
			if (!changed(String(event.data))) return;
			if (window.dispatchEvent(new CustomEvent('nua:external-change', { cancelable: true }))) location.reload();
		});
		socket.addEventListener('close', () => {
			setTimeout(connect, delay);
			delay = Math.min(delay * 2, 10000);
		});
	};
	connect();
})();`
}
