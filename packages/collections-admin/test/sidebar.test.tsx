import type { CmsConfig, CollectionDefinition } from '@nuasite/cms-types'
import { afterEach, describe, expect, test } from 'bun:test'
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

const originalFetch = globalThis.fetch
let root: Root | undefined

afterEach(async () => {
	await act(async () => root?.unmount())
	root = undefined
	globalThis.fetch = originalFetch
	document.body.innerHTML = ''
})

/**
 * Mount the app against a sidecar that answers the two reads the menu is built from. The app
 * makes its own client from `apiBase`, so the wire is the one seam there is.
 */
async function mountWith(config: CmsConfig | 'unavailable'): Promise<string[]> {
	const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
	const serve = async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
		const url = input instanceof Request ? input.url : String(input)
		if (url === `${API_BASE}/collections`) return json(COLLECTIONS)
		if (url === `${API_BASE}/config`) return config === 'unavailable' ? json({ error: 'No route', code: 'not_found' }, 404) : json(config)
		return json({ error: `Unexpected request: ${url}`, code: 'not_found' }, 404)
	}
	globalThis.fetch = Object.assign(serve, { preconnect: originalFetch.preconnect })

	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	await act(async () => {
		root?.render(createElement(CollectionsAdminApp, { apiBase: API_BASE }))
	})
	// The two reads resolve on their own turns; let both land.
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 0))
	})

	return [...container.querySelectorAll('.nua-cadmin-nav > *')].map((element) => {
		if (element.classList.contains('nua-cadmin-nav-group')) return `## ${element.textContent}`
		const label = element.querySelector('.nua-cadmin-nav-label')?.textContent ?? element.textContent ?? ''
		return element instanceof HTMLElement && element.style.paddingLeft ? `  ${label}` : label
	})
}

describe('collections-admin sidebar', () => {
	test('lists collections by the shared arrangement, in the project locale', async () => {
		expect(await mountWith({ locale: 'cs' })).toEqual([
			// `order` first, its nested collection indented under it…
			'FAQ',
			'  Otázky',
			// …then by label as Czech sorts it: "Č" after "C", "Ch" after "H"…
			'Cukr',
			'Čísla',
			'Hry',
			'Chaty',
			// …then the group, under its heading. The hidden collection is nowhere.
			'## English',
			'News',
		])
	})

	test('a project that declares no locale gets the fixed fallback order', async () => {
		expect(await mountWith({ listStyles: [] })).toEqual(['FAQ', '  Otázky', 'Chaty', 'Čísla', 'Cukr', 'Hry', '## English', 'News'])
	})

	test('an unreadable config does not take the menu down with it', async () => {
		expect(await mountWith('unavailable')).toEqual(['FAQ', '  Otázky', 'Chaty', 'Čísla', 'Cukr', 'Hry', '## English', 'News'])
	})
})
