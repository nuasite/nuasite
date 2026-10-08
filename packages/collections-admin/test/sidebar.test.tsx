import type { CmsConfig, CollectionDefinition } from '@nuasite/cms-types'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CollectionsAdminApp } from '../src/app'

// React's act() refuses to run unless the environment opts in.
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnv.IS_REACT_ACT_ENVIRONMENT = true

const API_BASE = 'http://sidecar.test/cms/v1'

const collection = (name: string, extra: Partial<CollectionDefinition> = {}): CollectionDefinition => ({
	name,
	label: name,
	path: `src/content/${name}`,
	entryCount: 0,
	fields: [],
	fileExtension: 'md',
	...extra,
})

/** Served the way a sidecar serves them: in no useful order, hidden ones included. */
const COLLECTIONS: CollectionDefinition[] = [
	collection('news-en', { label: 'News', group: 'English' }),
	collection('redirects', { label: 'Redirects', hidden: true }),
	collection('chaty', { label: 'Chaty' }),
	collection('faq-items', { label: 'Otázky', parentCollection: 'faq' }),
	collection('cukr', { label: 'Cukr' }),
	collection('faq', { label: 'FAQ', order: 1 }),
	collection('hry', { label: 'Hry' }),
	collection('cisla', { label: 'Čísla' }),
]

/** `order` first with its nested collection, then by label, then the group under its heading. The hidden one is nowhere. */
const IN_CZECH = ['FAQ', '  Otázky', 'Cukr', 'Čísla', 'Hry', 'Chaty', '## English', 'News']
/** The fixed fallback: compared as English, "Č" with "C" and "Ch" as two letters. */
const IN_FALLBACK = ['FAQ', '  Otázky', 'Chaty', 'Čísla', 'Cukr', 'Hry', '## English', 'News']

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const failed = () => json({ error: 'Sidecar is restarting', code: 'unknown' }, 503)

type Reply = () => Response | Promise<Response>

let root: Root | undefined
let container: HTMLElement
// The app reads two globals: `fetch`, and `window.location.hash` for its route. Other files in
// the run leave both in odd states (`fetch` unset or stubbed, `location` replaced by a bare
// object). Each test here installs its own for the duration and puts back what it found, so
// it neither depends on that nor adds to it.
let fetchBefore: typeof globalThis.fetch
let locationBefore: PropertyDescriptor | undefined

beforeEach(() => {
	fetchBefore = globalThis.fetch
	locationBefore = Object.getOwnPropertyDescriptor(window, 'location')
	Object.defineProperty(window, 'location', { value: { hash: '' }, writable: true, configurable: true })
})

afterEach(async () => {
	await act(async () => root?.unmount())
	root = undefined
	globalThis.fetch = fetchBefore
	if (locationBefore) Object.defineProperty(window, 'location', locationBefore)
	else Reflect.deleteProperty(window, 'location')
	document.body.innerHTML = ''
})

/** Let pending replies land and React flush. */
const settle = () =>
	act(async () => {
		await new Promise(resolve => setTimeout(resolve, 0))
	})

/**
 * Mount the app against a sidecar that answers the two reads the menu is built from. The app
 * makes its own client from `apiBase`, so the wire is the one seam there is.
 */
async function mount(routes: { collections?: Reply; config: Reply }): Promise<void> {
	const serve = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
		const url = input instanceof Request ? input.url : String(input)
		if (url === `${API_BASE}/collections`) return (routes.collections ?? (() => json(COLLECTIONS)))()
		if (url === `${API_BASE}/config`) return routes.config()
		return json({ error: `Unexpected request: ${url}`, code: 'not_found' }, 404)
	}
	globalThis.fetch = Object.assign(serve, { preconnect: Bun.fetch.preconnect })

	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	await act(async () => {
		root?.render(createElement(CollectionsAdminApp, { apiBase: API_BASE }))
	})
	await settle()
}

/** The menu as rendered, row by row: `## heading`, an indented nested collection, or a label. */
function menu(): string[] {
	return [...container.querySelectorAll('.nua-cadmin-nav > *')].map((element) => {
		if (element.classList.contains('nua-cadmin-nav-group')) return `## ${element.textContent}`
		const label = element.querySelector('.nua-cadmin-nav-label')?.textContent ?? element.textContent ?? ''
		return element instanceof HTMLElement && element.style.paddingLeft ? `  ${label}` : label
	})
}

describe('collections-admin sidebar', () => {
	test('lists collections by the shared arrangement, in the project locale', async () => {
		await mount({ config: () => json({ locale: 'cs' } satisfies CmsConfig) })
		expect(menu()).toEqual(IN_CZECH)
	})

	test('a project that declares no locale gets the fixed fallback order', async () => {
		await mount({ config: () => json({ listStyles: [] } satisfies CmsConfig) })
		expect(menu()).toEqual(IN_FALLBACK)
	})

	test('an unreadable config does not take the menu down with it', async () => {
		await mount({ config: failed })
		expect(menu()).toEqual(IN_FALLBACK)
	})

	test('a project whose collections are all hidden has nothing to list', async () => {
		const hidden = [collection('redirects', { hidden: true }), collection('tags', { hidden: true })]
		await mount({ collections: () => json(hidden), config: () => json({ locale: 'cs' } satisfies CmsConfig) })
		expect(menu()).toEqual(['No content types'])
	})

	test('the menu waits for the project locale instead of rendering once and reshuffling', async () => {
		let release: (response: Response) => void = () => {}
		await mount({ config: () => new Promise<Response>((resolve) => (release = resolve)) })
		// Collections have landed, the locale has not: nothing is listed in the fallback order.
		expect(menu()).toEqual(['Loading…'])

		release(json({ locale: 'cs' } satisfies CmsConfig))
		await settle()
		expect(menu()).toEqual(IN_CZECH)
	})

	// One bad moment takes both reads down; only the collections failure is visible. It is
	// offered for retry in two places, and either has to bring the locale back with it.
	for (
		const [where, selector, label] of [['the menu', '.nua-cadmin-nav-error', 'Failed to load — retry'], [
			'the main pane',
			'.nua-cadmin-retry',
			'Try again',
		]] as const
	) {
		test(`retry from ${where} re-reads a config that failed along with the collections`, async () => {
			let healthy = false
			let configReads = 0
			await mount({
				collections: () => (healthy ? json(COLLECTIONS) : failed()),
				config: () => {
					configReads++
					return healthy ? json({ locale: 'cs' } satisfies CmsConfig) : failed()
				},
			})
			const retry = container.querySelector<HTMLButtonElement>(selector)
			expect(retry?.textContent).toBe(label)
			expect(configReads).toBe(1)

			healthy = true
			await act(async () => retry?.click())
			await settle()
			// Not the fallback order: the locale came back with the retry too.
			expect(configReads).toBe(2)
			expect(menu()).toEqual(IN_CZECH)
		})
	}
})
