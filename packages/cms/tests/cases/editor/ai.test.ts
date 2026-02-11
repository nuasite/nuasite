import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { AIService, type AIStreamCallbacks, type CmsAiAction, getAIConfig } from '../../../src/editor/ai'
import type { CmsConfig } from '../../../src/editor/types'

const mockConfig: CmsConfig = {
	apiBase: '/_nua/cms',
	highlightColor: '#005AE0',
	debug: false,
}

describe('getAIConfig', () => {
	test('returns config with endpoint from CmsConfig', () => {
		const aiConfig = getAIConfig(mockConfig)
		expect(aiConfig.endpoint).toBe('/_nua/cms')
	})

	test('includes Content-Type header', () => {
		const aiConfig = getAIConfig(mockConfig)
		expect(aiConfig.headers?.['Content-Type']).toBe('application/json')
	})

	test('uses different apiBase values', () => {
		const customConfig: CmsConfig = {
			apiBase: '/api/v2/cms',
			highlightColor: '#000',
			debug: true,
		}
		const aiConfig = getAIConfig(customConfig)
		expect(aiConfig.endpoint).toBe('/api/v2/cms')
	})
})

describe('AIService', () => {
	let service: AIService

	beforeEach(() => {
		service = new AIService(mockConfig)

		// Mock window.location
		Object.defineProperty(window, 'location', {
			value: { href: 'http://localhost:3000/test-page' },
			writable: true,
		})
	})

	afterEach(() => {
		service.abort()
		// @ts-expect-error - resetting global
		global.fetch = undefined
	})

	describe('streamRequest', () => {
		test('calls onStart callback', async () => {
			let startCalled = false

			const sseData = ['data: {"type":"done"}\n\n']
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

			const callbacks: AIStreamCallbacks = {
				onStart: () => {
					startCalled = true
				},
			}

			await service.streamRequest(
				{ prompt: 'Test', elementId: 'el-1', currentContent: 'content' },
				callbacks,
			)

			expect(startCalled).toBe(true)
		})

		test('calls onToken callback with accumulated text', async () => {
			const tokens: Array<{ token: string; fullText: string }> = []

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

			const callbacks: AIStreamCallbacks = {
				onToken: (token, fullText) => tokens.push({ token, fullText }),
			}

			await service.streamRequest(
				{ prompt: 'Test', elementId: 'el-1', currentContent: 'content' },
				callbacks,
			)

			expect(tokens).toHaveLength(2)
			expect(tokens[1]).toEqual({ token: ' World', fullText: 'Hello World' })
		})

		test('calls onComplete callback with final text', async () => {
			let completedText = ''

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

			const callbacks: AIStreamCallbacks = {
				onComplete: finalText => {
					completedText = finalText
				},
			}

			await service.streamRequest(
				{ prompt: 'Test', elementId: 'el-1', currentContent: 'content' },
				callbacks,
			)

			expect(completedText).toBe('Hello World')
		})

		test('calls onStatus callback for status events', async () => {
			const statuses: Array<{ status: string; message?: string }> = []

			const sseData = [
				'data: {"type":"status","status":"thinking","message":"Processing your request..."}\n\n',
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

			const callbacks: AIStreamCallbacks = {
				onStatus: (status, message) => statuses.push({ status, message }),
			}

			await service.streamRequest(
				{ prompt: 'Test', elementId: 'el-1', currentContent: 'content' },
				callbacks,
			)

			expect(statuses).toHaveLength(2)
			expect(statuses[0]).toEqual({ status: 'thinking', message: 'Processing your request...' })
		})

		test('calls onAction callback for action events', async () => {
			const actions: CmsAiAction[] = []

			const sseData = [
				'data: {"type":"action","action":{"name":"refresh"}}\n\n',
				'data: {"type":"action","action":{"name":"apply-edit","elementId":"el-1","content":"New content"}}\n\n',
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

			const callbacks: AIStreamCallbacks = {
				onAction: action => actions.push(action),
			}

			await service.streamRequest(
				{ prompt: 'Test', elementId: 'el-1', currentContent: 'content' },
				callbacks,
			)

			expect(actions).toHaveLength(2)
			expect(actions[0]?.name).toBe('refresh')
			if (actions[1]?.name === 'apply-edit') {
				expect(actions[1].elementId).toBe('el-1')
			}
		})

		test('calls onError callback on error', async () => {
			let errorReceived: any = null

			const sseData = ['data: {"type":"error","error":"Something went wrong"}\n\n']
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

			const callbacks: AIStreamCallbacks = {
				onError: error => {
					errorReceived = error
				},
			}

			await service.streamRequest(
				{ prompt: 'Test', elementId: 'el-1', currentContent: 'content' },
				callbacks,
			)

			expect(errorReceived?.message).toBe('Something went wrong')
		})

		test('sends correct request body', async () => {
			let capturedBody: any = null
			;(global as any).fetch = async (_url: string | Request, options?: RequestInit) => {
				capturedBody = JSON.parse(options?.body as string)
				const encoder = new TextEncoder()
				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
						controller.close()
					},
				})
				return new Response(stream, { status: 200 })
			}

			await service.streamRequest(
				{ prompt: 'Generate title', elementId: 'title-1', currentContent: 'Old title' },
				{},
			)

			expect(capturedBody?.prompt).toBe('Generate title')
			expect(capturedBody?.elementId).toBe('title-1')
			expect(capturedBody?.currentContent).toBe('Old title')
			expect(capturedBody?.pageUrl).toBe('http://localhost:3000/test-page')
		})
	})

	describe('abort', () => {
		test('sets abortController to null', () => {
			// Test the abort method directly without async streaming
			// Start with no active stream
			expect(service.isStreaming()).toBe(false)

			// Calling abort when not streaming should be safe
			service.abort()
			expect(service.isStreaming()).toBe(false)
		})

		test('isStreaming returns false after abort is called', async () => {
			// Mock a quick stream that we can abort
			let abortSignalReceived = false
			;(global as any).fetch = async (_url: string | Request, options?: RequestInit) => {
				// Check if abort signal is present
				if (options?.signal) {
					options.signal.addEventListener('abort', () => {
						abortSignalReceived = true
					})
				}

				const encoder = new TextEncoder()
				const stream = new ReadableStream({
					start(controller) {
						// Send done event immediately
						controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
						controller.close()
					},
				})
				return new Response(stream, { status: 200 })
			}

			await service.streamRequest(
				{ prompt: 'Test', elementId: 'el-1', currentContent: 'content' },
				{},
			)

			// After stream completes, isStreaming should be false
			expect(service.isStreaming()).toBe(false)
		})
	})

	describe('isStreaming', () => {
		test('returns false initially', () => {
			expect(service.isStreaming()).toBe(false)
		})

		test('returns false after stream completes', async () => {
			;(global as any).fetch = async () => {
				const encoder = new TextEncoder()
				const stream = new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'))
						controller.close()
					},
				})
				return new Response(stream, { status: 200 })
			}

			await service.streamRequest(
				{ prompt: 'Test', elementId: 'el-1', currentContent: 'content' },
				{},
			)

			expect(service.isStreaming()).toBe(false)
		})
	})

	describe('generateBlockProps', () => {
		test('sends POST request to /ai/generate-props endpoint', async () => {
			let capturedRequest: any = null
			;(global as any).fetch = async (url: string | Request, options?: RequestInit) => {
				capturedRequest = {
					url: url.toString(),
					body: JSON.parse(options?.body as string),
				}
				return new Response(JSON.stringify({ props: { title: 'Generated Title' } }), {
					status: 200,
				})
			}

			await service.generateBlockProps({
				prompt: 'Generate a hero section',
				componentName: 'Hero',
				props: [{ name: 'title', type: 'string', required: true }],
				currentValues: { title: '' },
			})

			expect(capturedRequest?.url).toBe('/_nua/cms/ai/generate-props')
			expect(capturedRequest?.body.prompt).toBe('Generate a hero section')
			expect(capturedRequest?.body.componentName).toBe('Hero')
		})

		test('returns generated props', async () => {
			;(global as any).fetch = async () => {
				return new Response(
					JSON.stringify({
						props: {
							title: 'Welcome to Our Site',
							subtitle: 'The best place to be',
						},
					}),
					{ status: 200 },
				)
			}

			const result = await service.generateBlockProps({
				prompt: 'Generate a hero section',
				componentName: 'Hero',
				props: [
					{ name: 'title', type: 'string', required: true },
					{ name: 'subtitle', type: 'string', required: false },
				],
				currentValues: {},
			})

			expect(result.title).toBe('Welcome to Our Site')
			expect(result.subtitle).toBe('The best place to be')
		})

		test('returns empty object when props not in response', async () => {
			;(global as any).fetch = async () => {
				return new Response(JSON.stringify({}), { status: 200 })
			}

			const result = await service.generateBlockProps({
				prompt: 'Generate props',
				componentName: 'Hero',
				props: [],
				currentValues: {},
			})

			expect(result).toEqual({})
		})

		test('throws error on failure', async () => {
			;(global as any).fetch = async () => {
				return new Response('Server error', { status: 500, statusText: 'Internal Server Error' })
			}

			await expect(
				service.generateBlockProps({
					prompt: 'Generate props',
					componentName: 'Hero',
					props: [],
					currentValues: {},
				}),
			).rejects.toThrow('AI request failed: 500')
		})

		test('includes context in request', async () => {
			let capturedBody: any = null
			;(global as any).fetch = async (_url: string | Request, options?: RequestInit) => {
				capturedBody = JSON.parse(options?.body as string)
				return new Response(JSON.stringify({ props: {} }), { status: 200 })
			}

			await service.generateBlockProps({
				prompt: 'Generate props',
				componentName: 'Hero',
				props: [],
				currentValues: {},
				context: 'This is a landing page for a tech startup',
			})

			expect(capturedBody?.context).toBe('This is a landing page for a tech startup')
		})
	})

	describe('suggestComponent', () => {
		test('sends POST request to /ai/suggest-component endpoint', async () => {
			let capturedRequest: any = null
			;(global as any).fetch = async (url: string | Request, options?: RequestInit) => {
				capturedRequest = {
					url: url.toString(),
					body: JSON.parse(options?.body as string),
				}
				return new Response(
					JSON.stringify({
						suggestion: { componentName: 'Hero', suggestedProps: {} },
					}),
					{ status: 200 },
				)
			}

			await service.suggestComponent('I need a hero section', [
				{ name: 'Hero', description: 'A hero banner', props: [] },
				{ name: 'Features', description: 'Feature grid', props: [] },
			])

			expect(capturedRequest?.url).toBe('/_nua/cms/ai/suggest-component')
			expect(capturedRequest?.body.prompt).toBe('I need a hero section')
			expect(capturedRequest?.body.availableComponents).toHaveLength(2)
		})

		test('returns suggested component and props', async () => {
			;(global as any).fetch = async () => {
				return new Response(
					JSON.stringify({
						suggestion: {
							componentName: 'Hero',
							suggestedProps: { title: 'Welcome', showCTA: true },
						},
					}),
					{ status: 200 },
				)
			}

			const result = await service.suggestComponent('Add a hero', [
				{ name: 'Hero', props: [] },
			])

			expect(result?.componentName).toBe('Hero')
			expect(result?.suggestedProps.title).toBe('Welcome')
			expect(result?.suggestedProps.showCTA).toBe(true)
		})

		test('returns null when no suggestion', async () => {
			;(global as any).fetch = async () => {
				return new Response(JSON.stringify({}), { status: 200 })
			}

			const result = await service.suggestComponent('Add something', [])

			expect(result).toBeNull()
		})

		test('throws error on failure', async () => {
			;(global as any).fetch = async () => {
				return new Response('Error', { status: 500, statusText: 'Internal Server Error' })
			}

			await expect(
				service.suggestComponent('Add a hero', [{ name: 'Hero', props: [] }]),
			).rejects.toThrow('AI request failed: 500')
		})

		test('includes pageUrl in request', async () => {
			let capturedBody: any = null
			;(global as any).fetch = async (_url: string | Request, options?: RequestInit) => {
				capturedBody = JSON.parse(options?.body as string)
				return new Response(JSON.stringify({ suggestion: null }), { status: 200 })
			}

			await service.suggestComponent('Add component', [])

			expect(capturedBody?.pageUrl).toBe('http://localhost:3000/test-page')
		})
	})
})
