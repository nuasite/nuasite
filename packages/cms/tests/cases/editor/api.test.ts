import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	fetchManifest,
	getPageManifestUrl,
	insertComponent,
	saveBatchChanges,
} from '../../../src/editor/api'
import type { CmsManifest, SaveBatchRequest } from '../../../src/editor/types'

describe('getPageManifestUrl', () => {
	test('returns /index.json for root path', () => {
		expect(getPageManifestUrl('/')).toBe('/index.json')
		expect(getPageManifestUrl('')).toBe('/index.json')
	})

	test('returns correct json path for simple pages', () => {
		expect(getPageManifestUrl('/about')).toBe('/about.json')
		expect(getPageManifestUrl('/contact')).toBe('/contact.json')
	})

	test('returns correct json path for nested pages', () => {
		expect(getPageManifestUrl('/blog/post')).toBe('/blog/post.json')
		expect(getPageManifestUrl('/docs/api/reference')).toBe('/docs/api/reference.json')
	})

	test('removes trailing slash before adding .json', () => {
		expect(getPageManifestUrl('/about/')).toBe('/about.json')
		expect(getPageManifestUrl('/blog/post/')).toBe('/blog/post.json')
	})

	test('preserves single slash for root', () => {
		expect(getPageManifestUrl('/')).toBe('/index.json')
	})
})

describe('fetchManifest', () => {
	const mockManifest: CmsManifest = {
		entries: {
			'entry-1': { id: 'entry-1', sourcePath: '/test.astro', tag: 'h1', text: 'Test' },
		},
		components: {},
		componentDefinitions: {},
	}

	beforeEach(() => {
		// Mock window.location
		Object.defineProperty(window, 'location', {
			value: { pathname: '/about' },
			writable: true,
		})
	})

	afterEach(() => {
		// @ts-expect-error - resetting global
		global.fetch = undefined
	})

	test('fetches both page-specific and global manifest in parallel', async () => {
		const fetchedUrls: string[] = []
		;(global as any).fetch = async (url: string | Request) => {
			fetchedUrls.push(url.toString())
			return new Response(JSON.stringify(mockManifest), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}

		await fetchManifest()
		// Both manifests are fetched in parallel (URLs include cache-busting timestamps)
		expect(fetchedUrls.some(url => url.startsWith('/about.json'))).toBe(true)
		expect(fetchedUrls.some(url => url.startsWith('/cms-manifest.json'))).toBe(true)
	})

	test('falls back to cms-manifest.json when page manifest fails', async () => {
		const fetchedUrls: string[] = []
		;(global as any).fetch = async (url: string | Request) => {
			fetchedUrls.push(url.toString())
			if (url.toString().includes('/about.json')) {
				return new Response('Not found', { status: 404 })
			}
			return new Response(JSON.stringify(mockManifest), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}

		await fetchManifest()
		expect(fetchedUrls.some(url => url.startsWith('/about.json'))).toBe(true)
		expect(fetchedUrls.some(url => url.startsWith('/cms-manifest.json'))).toBe(true)
	})

	test('throws error when all sources fail', async () => {
		;(global as any).fetch = async () => {
			return new Response('Not found', { status: 404 })
		}

		await expect(fetchManifest()).rejects.toThrow('Failed to load manifest from all sources')
	})

	test('returns manifest data on success', async () => {
		;(global as any).fetch = async () => {
			return new Response(JSON.stringify(mockManifest), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}

		const result = await fetchManifest()
		// The merged manifest contains entries from the page manifest
		expect(result.entries['entry-1']?.text).toBe('Test')
		expect(result.entries['entry-1']?.id).toBe('entry-1')
	})
})

describe('saveBatchChanges', () => {
	afterEach(() => {
		// @ts-expect-error - resetting global
		global.fetch = undefined
	})

	test('sends POST request to /update endpoint', async () => {
		let capturedRequest: any = null
		;(global as any).fetch = async (url: string | Request, options?: RequestInit) => {
			capturedRequest = {
				url: url.toString(),
				method: options?.method || 'GET',
				body: options?.body as string,
			}
			return new Response(JSON.stringify({ updated: 2 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}

		const request: SaveBatchRequest = {
			changes: [
				{
					cmsId: 'entry-1',
					newValue: 'New content 1',
					originalValue: 'Old 1',
					sourcePath: '/test.astro',
					sourceLine: 1,
					sourceSnippet: '<h1>Old 1</h1>',
				},
				{ cmsId: 'entry-2', newValue: 'New content 2', originalValue: 'Old 2', sourcePath: '/test.astro', sourceLine: 2, sourceSnippet: '<p>Old 2</p>' },
			],
			meta: { source: 'test', url: '/test' },
		}

		await saveBatchChanges('/_nua/cms', request)

		expect(capturedRequest?.url).toBe('/_nua/cms/update')
		expect(capturedRequest?.method).toBe('POST')
		expect(JSON.parse(capturedRequest?.body || '{}')).toEqual(request)
	})

	test('returns response data on success', async () => {
		;(global as any).fetch = async () => {
			return new Response(JSON.stringify({ updated: 3 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		}

		const result = await saveBatchChanges('/_nua/cms', { changes: [], meta: { source: 'test', url: '/test' } })
		expect(result.updated).toBe(3)
	})

	test('throws error on non-ok response', async () => {
		;(global as any).fetch = async () => {
			return new Response('Server error', { status: 500, statusText: 'Internal Server Error' })
		}

		await expect(saveBatchChanges('/_nua/cms', { changes: [], meta: { source: 'test', url: '/test' } })).rejects.toThrow(
			'Save failed (500): Server error',
		)
	})

	test('returns default response when json parsing fails', async () => {
		;(global as any).fetch = async () => {
			return new Response('OK', {
				status: 200,
				headers: { 'Content-Type': 'text/plain' },
			})
		}

		const result = await saveBatchChanges('/_nua/cms', { changes: [], meta: { source: 'test', url: '/test' } })
		expect(result.updated).toBe(0)
	})
})

describe('insertComponent', () => {
	afterEach(() => {
		// @ts-expect-error - resetting global
		global.fetch = undefined
	})

	test('sends POST request to /insert-component endpoint', async () => {
		let capturedBody: any = null
		;(global as any).fetch = async (_url: string | Request, options?: RequestInit) => {
			capturedBody = JSON.parse(options?.body as string)
			return new Response(
				JSON.stringify({
					success: true,
					sourceFile: '/src/pages/index.astro',
					commit: 'abc123',
				}),
				{ status: 200 },
			)
		}

		await insertComponent('/_nua/cms', {
			position: 'after',
			referenceComponentId: 'comp-1',
			componentName: 'Hero',
			props: { title: 'Welcome' },
		})

		expect(capturedBody?.position).toBe('after')
		expect(capturedBody?.referenceComponentId).toBe('comp-1')
		expect(capturedBody?.componentName).toBe('Hero')
		expect(capturedBody?.props).toEqual({ title: 'Welcome' })
	})

	test('returns success response', async () => {
		;(global as any).fetch = async () => {
			return new Response(
				JSON.stringify({
					success: true,
					sourceFile: '/src/pages/index.astro',
					commit: 'abc123',
					commitMessage: 'Add Hero component',
				}),
				{ status: 200 },
			)
		}

		const result = await insertComponent('/_nua/cms', {
			position: 'before',
			referenceComponentId: 'comp-1',
			componentName: 'Hero',
			props: {},
		})

		expect(result.success).toBe(true)
		expect(result.commit).toBe('abc123')
	})

	test('throws error on failure', async () => {
		;(global as any).fetch = async () => {
			return new Response('Component not found', { status: 404, statusText: 'Not Found' })
		}

		await expect(
			insertComponent('/_nua/cms', {
				position: 'after',
				referenceComponentId: 'comp-1',
				componentName: 'Hero',
				props: {},
			}),
		).rejects.toThrow('Insert component failed (404)')
	})
})

