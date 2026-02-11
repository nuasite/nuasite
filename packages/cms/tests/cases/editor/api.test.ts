import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
	type CmsAiEvent,
	type CmsAiStreamCallbacks,
	fetchManifest,
	getChatHistory,
	getPageManifestUrl,
	insertComponent,
	parseSseEvent,
	saveBatchChanges,
	streamAiChat,
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

describe('parseSseEvent', () => {
	test('parses [DONE] as done event', () => {
		const result = parseSseEvent('[DONE]')
		expect(result).toEqual({ type: 'done' })
	})

	test('parses token event', () => {
		const data = JSON.stringify({ type: 'token', token: 'Hello', fullText: 'Hello' })
		const result = parseSseEvent(data) as CmsAiEvent
		expect(result.type).toBe('token')
		if (result.type === 'token') {
			expect(result.token).toBe('Hello')
			expect(result.fullText).toBe('Hello')
		}
	})

	test('parses status event', () => {
		const data = JSON.stringify({ type: 'status', status: 'thinking', message: 'Processing...' })
		const result = parseSseEvent(data) as CmsAiEvent
		expect(result.type).toBe('status')
		if (result.type === 'status') {
			expect(result.status).toBe('thinking')
			expect(result.message).toBe('Processing...')
		}
	})

	test('parses action event with refresh', () => {
		const data = JSON.stringify({ type: 'action', action: { name: 'refresh' } })
		const result = parseSseEvent(data) as CmsAiEvent
		expect(result.type).toBe('action')
		if (result.type === 'action') {
			expect(result.action.name).toBe('refresh')
		}
	})

	test('parses action event with apply-edit', () => {
		const data = JSON.stringify({
			type: 'action',
			action: { name: 'apply-edit', elementId: 'el-1', content: 'New content' },
		})
		const result = parseSseEvent(data) as CmsAiEvent
		expect(result.type).toBe('action')
		if (result.type === 'action' && result.action.name === 'apply-edit') {
			expect(result.action.elementId).toBe('el-1')
			expect(result.action.content).toBe('New content')
		}
	})

	test('parses error event', () => {
		const data = JSON.stringify({ type: 'error', error: 'Something went wrong', code: 'ERR_500' })
		const result = parseSseEvent(data) as CmsAiEvent
		expect(result.type).toBe('error')
		if (result.type === 'error') {
			expect(result.error).toBe('Something went wrong')
			expect(result.code).toBe('ERR_500')
		}
	})

	test('parses done event with summary', () => {
		const data = JSON.stringify({ type: 'done', summary: 'Completed successfully' })
		const result = parseSseEvent(data) as CmsAiEvent
		expect(result.type).toBe('done')
		if (result.type === 'done') {
			expect(result.summary).toBe('Completed successfully')
		}
	})

	test('returns null for invalid JSON', () => {
		expect(parseSseEvent('not valid json')).toBeNull()
		expect(parseSseEvent('{')).toBeNull()
		expect(parseSseEvent('')).toBeNull()
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

describe('getChatHistory', () => {
	afterEach(() => {
		// @ts-expect-error - resetting global
		global.fetch = undefined
	})

	test('fetches chat history with default limit', async () => {
		let fetchedUrl = ''
		;(global as any).fetch = async (url: string | Request) => {
			fetchedUrl = url.toString()
			return new Response(JSON.stringify({ messages: [], hasMore: false }), { status: 200 })
		}

		await getChatHistory('/_nua/cms')
		expect(fetchedUrl).toBe('/_nua/cms/ai/chat/history?limit=50')
	})

	test('fetches chat history with custom limit', async () => {
		let fetchedUrl = ''
		;(global as any).fetch = async (url: string | Request) => {
			fetchedUrl = url.toString()
			return new Response(JSON.stringify({ messages: [], hasMore: false }), { status: 200 })
		}

		await getChatHistory('/_nua/cms', 100)
		expect(fetchedUrl).toBe('/_nua/cms/ai/chat/history?limit=100')
	})

	test('returns chat history data', async () => {
		const mockHistory = {
			messages: [
				{ id: '1', role: 'user', content: 'Hello', created_at: '2024-01-01T00:00:00Z' },
				{ id: '2', role: 'assistant', content: 'Hi there!', created_at: '2024-01-01T00:00:01Z' },
			],
			hasMore: true,
		}
		;(global as any).fetch = async () => {
			return new Response(JSON.stringify(mockHistory), { status: 200 })
		}

		const result = await getChatHistory('/_nua/cms')
		expect(result.messages).toHaveLength(2)
		expect(result.hasMore).toBe(true)
	})

	test('throws error on failure', async () => {
		;(global as any).fetch = async () => {
			return new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
		}

		await expect(getChatHistory('/_nua/cms')).rejects.toThrow('Failed to fetch chat history (401)')
	})
})

describe('streamAiChat', () => {
	afterEach(() => {
		// @ts-expect-error - resetting global
		global.fetch = undefined
	})

	test('calls onToken callback for token events', async () => {
		const tokens: Array<{ token: string; fullText: string }> = []

		// Create a mock readable stream with SSE data
		const sseData = [
			'data: {"type":"token","token":"Hello","fullText":"Hello"}\n\n',
			'data: {"type":"token","token":" World","fullText":"Hello World"}\n\n',
			'data: {"type":"done"}\n\n',
		]
		;(global as any).fetch = async () => {
			const encoder = new TextEncoder()
			const stream = new ReadableStream({
				start(controller) {
					for (const chunk of sseData) {
						controller.enqueue(encoder.encode(chunk))
					}
					controller.close()
				},
			})

			return new Response(stream, { status: 200 })
		}

		const callbacks: CmsAiStreamCallbacks = {
			onToken: (token, fullText) => tokens.push({ token, fullText }),
		}

		await streamAiChat(
			'/_nua/cms',
			{ prompt: 'Test', pageUrl: 'http://localhost' },
			callbacks,
		)

		expect(tokens).toHaveLength(2)
		expect(tokens[0]).toEqual({ token: 'Hello', fullText: 'Hello' })
		expect(tokens[1]).toEqual({ token: ' World', fullText: 'Hello World' })
	})

	test('calls onStatus callback for status events', async () => {
		const statuses: Array<{ status: string; message?: string }> = []

		const sseData = [
			'data: {"type":"status","status":"thinking","message":"Processing..."}\n\n',
			'data: {"type":"status","status":"coding"}\n\n',
			'data: {"type":"done"}\n\n',
		]
		;(global as any).fetch = async () => {
			const encoder = new TextEncoder()
			const stream = new ReadableStream({
				start(controller) {
					for (const chunk of sseData) {
						controller.enqueue(encoder.encode(chunk))
					}
					controller.close()
				},
			})

			return new Response(stream, { status: 200 })
		}

		const callbacks: CmsAiStreamCallbacks = {
			onStatus: (status, message) => statuses.push({ status, message }),
		}

		await streamAiChat(
			'/_nua/cms',
			{ prompt: 'Test', pageUrl: 'http://localhost' },
			callbacks,
		)

		expect(statuses).toHaveLength(2)
		expect(statuses[0]).toEqual({ status: 'thinking', message: 'Processing...' })
		expect(statuses[1]).toEqual({ status: 'coding', message: undefined })
	})

	test('calls onAction callback for action events', async () => {
		const actions: Array<{ name: string }> = []

		const sseData = [
			'data: {"type":"action","action":{"name":"refresh"}}\n\n',
			'data: {"type":"done"}\n\n',
		]
		;(global as any).fetch = async () => {
			const encoder = new TextEncoder()
			const stream = new ReadableStream({
				start(controller) {
					for (const chunk of sseData) {
						controller.enqueue(encoder.encode(chunk))
					}
					controller.close()
				},
			})

			return new Response(stream, { status: 200 })
		}

		const callbacks: CmsAiStreamCallbacks = {
			onAction: action => actions.push(action),
		}

		await streamAiChat(
			'/_nua/cms',
			{ prompt: 'Test', pageUrl: 'http://localhost' },
			callbacks,
		)

		expect(actions).toHaveLength(1)
		expect(actions[0]?.name).toBe('refresh')
	})

	test('calls onError callback for error events', async () => {
		const errors: Array<{ error: string; code?: string }> = []

		const sseData = ['data: {"type":"error","error":"Something went wrong","code":"ERR_500"}\n\n']
		;(global as any).fetch = async () => {
			const encoder = new TextEncoder()
			const stream = new ReadableStream({
				start(controller) {
					for (const chunk of sseData) {
						controller.enqueue(encoder.encode(chunk))
					}
					controller.close()
				},
			})

			return new Response(stream, { status: 200 })
		}

		const callbacks: CmsAiStreamCallbacks = {
			onError: (error, code) => errors.push({ error, code }),
		}

		await streamAiChat(
			'/_nua/cms',
			{ prompt: 'Test', pageUrl: 'http://localhost' },
			callbacks,
		)

		expect(errors).toHaveLength(1)
		expect(errors[0]).toEqual({ error: 'Something went wrong', code: 'ERR_500' })
	})

	test('calls onDone callback when stream completes', async () => {
		let doneReceived = false
		let doneSummary: string | undefined

		const sseData = ['data: {"type":"done","summary":"Completed successfully"}\n\n']
		;(global as any).fetch = async () => {
			const encoder = new TextEncoder()
			const stream = new ReadableStream({
				start(controller) {
					for (const chunk of sseData) {
						controller.enqueue(encoder.encode(chunk))
					}
					controller.close()
				},
			})

			return new Response(stream, { status: 200 })
		}

		const callbacks: CmsAiStreamCallbacks = {
			onDone: summary => {
				doneReceived = true
				doneSummary = summary
			},
		}

		await streamAiChat(
			'/_nua/cms',
			{ prompt: 'Test', pageUrl: 'http://localhost' },
			callbacks,
		)

		expect(doneReceived).toBe(true)
		expect(doneSummary).toBe('Completed successfully')
	})

	test('calls onError for non-ok response', async () => {
		const errors: string[] = []
		;(global as any).fetch = async () => {
			return new Response('Unauthorized', { status: 401 })
		}

		const callbacks: CmsAiStreamCallbacks = {
			onError: error => errors.push(error),
		}

		await streamAiChat(
			'/_nua/cms',
			{ prompt: 'Test', pageUrl: 'http://localhost' },
			callbacks,
		)

		expect(errors).toHaveLength(1)
		expect(errors[0]).toBe('Unauthorized')
	})

	test('calls onError when response has no body', async () => {
		const errors: string[] = []
		;(global as any).fetch = async () => {
			return new Response(null, { status: 200 })
		}

		const callbacks: CmsAiStreamCallbacks = {
			onError: error => errors.push(error),
		}

		await streamAiChat(
			'/_nua/cms',
			{ prompt: 'Test', pageUrl: 'http://localhost' },
			callbacks,
		)

		expect(errors).toHaveLength(1)
		expect(errors[0]).toBe('No response body')
	})
})
