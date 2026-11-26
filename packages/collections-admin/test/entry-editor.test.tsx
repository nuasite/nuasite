import { createClient } from '@nuasite/cms-client'
import type { CollectionDefinition, CollectionEntry } from '@nuasite/cms-types'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EntryEditor } from '../src/entry-editor'

// ---------------------------------------------------------------------------
// The editor holds the version of the entry it shows: the `sourceHash` of the read it was built
// from. Every write sends it, so a change made elsewhere since is refused, not overwritten.
// ---------------------------------------------------------------------------

// React's act() refuses to run unless the environment opts in.
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnv.IS_REACT_ACT_ENVIRONMENT = true

const API_BASE = 'http://sidecar.test/cms/v1'
const ENTRY_URL = `${API_BASE}/collections/docs/entries/annual`
const LOADED_HASH = 'sha256:loaded'

const definition: CollectionDefinition = {
	name: 'docs',
	label: 'Docs',
	path: 'src/content/docs',
	entryCount: 1,
	// A data collection: no body, so the Markdown editor stays out of these tests.
	type: 'data',
	fileExtension: 'yaml',
	fields: [{ name: 'title', type: 'text', required: true }],
}

const entry: CollectionEntry = {
	collectionName: 'docs',
	collectionSlug: 'annual',
	sourcePath: 'src/content/docs/annual.yaml',
	sourceHash: LOADED_HASH,
	frontmatter: { title: { value: 'Annual report', line: 1 } },
	body: '',
	bodyStartLine: 2,
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Sent {
	method: string
	body: unknown
}

let root: Root | undefined
let container: HTMLElement
let fetchBefore: typeof globalThis.fetch
let confirmBefore: typeof window.confirm

beforeEach(() => {
	fetchBefore = globalThis.fetch
	confirmBefore = window.confirm
	window.confirm = () => true
})

afterEach(async () => {
	await act(async () => root?.unmount())
	root = undefined
	globalThis.fetch = fetchBefore
	window.confirm = confirmBefore
	document.body.innerHTML = ''
})

const settle = () =>
	act(async () => {
		await new Promise(resolve => setTimeout(resolve, 0))
	})

/** Open the entry against a sidecar that serves it and answers each write with `write`. */
async function open(write: (sent: Sent) => Response | Promise<Response>): Promise<Sent[]> {
	const sent: Sent[] = []
	const serve = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
		const url = input instanceof Request ? input.url : String(input)
		const method = init?.method ?? 'GET'
		if (url === ENTRY_URL && method === 'GET') return json(entry)
		if (url.startsWith(ENTRY_URL)) {
			const request = { method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined }
			sent.push(request)
			return write(request)
		}
		return json({ error: `Unexpected request: ${method} ${url}`, code: 'not_found' }, 404)
	}
	globalThis.fetch = Object.assign(serve, { preconnect: Bun.fetch.preconnect })

	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	await act(async () => {
		root?.render(createElement(EntryEditor, {
			client: createClient(API_BASE),
			definition,
			collection: 'docs',
			slug: 'annual',
			onDeleted: () => {},
			onRenamed: () => {},
		}))
	})
	await settle()
	return sent
}

function typeTitle(value: string): void {
	const input = container.querySelector('input')
	if (!(input instanceof HTMLInputElement)) throw new Error('No title input')
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
	input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Past the editor's save debounce. */
const debounced = () =>
	act(async () => {
		await new Promise(resolve => setTimeout(resolve, 800))
	})

function button(label: string): HTMLButtonElement {
	const found = [...container.querySelectorAll('button')].find(candidate => candidate.textContent === label)
	if (!found) throw new Error(`No ${label} button`)
	return found
}

describe('the entry editor sends the version it shows', () => {
	test('the first save carries the hash of the read the draft was built from', async () => {
		const sent = await open(() => json({ success: true, sourceHash: 'sha256:saved' }))

		await act(async () => typeTitle('Annual report 2025'))
		await debounced()

		expect(sent).toEqual([{ method: 'PATCH', body: expect.objectContaining({ baseHash: LOADED_HASH }) }])
	})

	test('delete carries the hash, and a 409 says the entry changed since it was opened', async () => {
		const sent = await open(() => json({ code: 'conflict', serverHash: 'sha256:theirs', serverFrontmatter: {} }, 409))

		await act(async () => button('Delete').click())
		await settle()

		expect(sent).toEqual([{ method: 'DELETE', body: { baseHash: LOADED_HASH } }])
		expect(container.textContent).toContain('This entry changed since you opened it. Reopen it to see the current version.')
	})

	test('delete and rename wait while a save is in flight: they would carry the version it replaces', async () => {
		let answer: (response: Response) => void = () => {}
		await open(({ method }) => (method === 'PATCH' ? new Promise<Response>(resolve => (answer = resolve)) : json({ success: true })))

		await act(async () => typeTitle('Annual report 2025'))
		await debounced()

		expect(button('Delete').disabled).toBe(true)
		expect(button('Rename').disabled).toBe(true)

		await act(async () => answer(json({ success: true, sourceHash: 'sha256:saved' })))
		await settle()

		expect(button('Delete').disabled).toBe(false)
		expect(button('Rename').disabled).toBe(false)
	})
})
