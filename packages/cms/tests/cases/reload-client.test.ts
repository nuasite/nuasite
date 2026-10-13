import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { reloadClientScript } from '../../src/reload-client'

type Listener = (event: { data?: unknown }) => void

/** Stands in for the browser's WebSocket: records the URL and lets the test deliver events. */
class FakeSocket {
	readonly listeners = new Map<string, Listener[]>()
	constructor(readonly url: URL) {}
	addEventListener(type: string, listener: Listener): void {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
	}
	emit(type: string, event: { data?: unknown } = {}): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event)
	}
}

/** Run the script in a page of its own: a window, a location and a WebSocket the test controls. */
function start(revision?: string) {
	const sockets: FakeSocket[] = []
	const window = new EventTarget()
	const location = { href: 'https://preview.test/about', reloads: 0, reload: () => location.reloads++ }
	runInNewContext(reloadClientScript({ url: '/_live', revision }), {
		window,
		location,
		URL,
		JSON,
		CustomEvent,
		setTimeout,
		WebSocket: class extends FakeSocket {
			constructor(url: URL) {
				super(url)
				sockets.push(this)
			}
		},
	})
	const socket = sockets[0]
	if (!socket) throw new Error('The client opened no socket')
	return { socket, window, location }
}

describe('reloadClientScript', () => {
	test('connects to the URL resolved against the page, as a WebSocket URL', () => {
		const { socket } = start()
		expect(socket.url.href).toBe('wss://preview.test/_live')
	})

	test('reloads on a revision other than the page one, not on the same one', () => {
		const { socket, location } = start('r1')
		socket.emit('message', { data: JSON.stringify({ revision: 'r1' }) })
		expect(location.reloads).toBe(0)
		socket.emit('message', { data: JSON.stringify({ revision: 'r2' }) })
		expect(location.reloads).toBe(1)
	})

	test('a listener that cancels nua:external-change keeps the page', () => {
		const { socket, window, location } = start()
		window.addEventListener('nua:external-change', event => event.preventDefault())
		socket.emit('message', { data: '{}' })
		expect(location.reloads).toBe(0)
	})
})
