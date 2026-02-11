import { afterEach, describe, expect, test } from 'bun:test'
import {
	createMarkdownPage,
	deleteMedia,
	fetchMarkdownContent,
	fetchMediaLibrary,
	updateMarkdownPage,
	uploadMedia,
} from '../../../src/editor/markdown-api'
import type { CmsConfig } from '../../../src/editor/types'

const mockConfig: CmsConfig = {
	apiBase: '/_nua/cms',
	highlightColor: '#005AE0',
	debug: false,
}

afterEach(() => {
	// @ts-expect-error - resetting global
	global.fetch = undefined
})

describe('createMarkdownPage', () => {
	test('sends POST request to /markdown/create endpoint', async () => {
		let capturedRequest: any = null
		;(global as any).fetch = async (url: string | Request, options?: RequestInit) => {
			capturedRequest = {
				url: url.toString(),
				body: JSON.parse(options?.body as string),
			}
			return new Response(
				JSON.stringify({
					success: true,
					filePath: '/content/blog/new-post.md',
					url: '/blog/new-post',
				}),
				{ status: 200 },
			)
		}

		await createMarkdownPage(mockConfig, {
			collection: 'blog',
			slug: 'new-post',
			title: 'New Post',
			content: '# Hello World',
		})

		expect(capturedRequest?.url).toBe('/_nua/cms/markdown/create')
		expect(capturedRequest?.body.collection).toBe('blog')
		expect(capturedRequest?.body.slug).toBe('new-post')
		expect(capturedRequest?.body.title).toBe('New Post')
	})

	test('returns success response with file path and url', async () => {
		;(global as any).fetch = async () => {
			return new Response(
				JSON.stringify({
					success: true,
					filePath: '/content/blog/my-post.md',
					url: '/blog/my-post',
				}),
				{ status: 200 },
			)
		}

		const result = await createMarkdownPage(mockConfig, {
			collection: 'blog',
			slug: 'my-post',
			title: 'My Post',
		})

		expect(result.success).toBe(true)
		expect(result.filePath).toBe('/content/blog/my-post.md')
		expect(result.url).toBe('/blog/my-post')
	})

	test('returns error response on failure', async () => {
		;(global as any).fetch = async () => {
			return new Response('Slug already exists', { status: 409, statusText: 'Conflict' })
		}

		const result = await createMarkdownPage(mockConfig, {
			collection: 'blog',
			slug: 'existing-post',
			title: 'Existing Post',
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain('Create page failed (409)')
	})

	test('handles frontmatter in request', async () => {
		let capturedBody: any = null
		;(global as any).fetch = async (_url: string | Request, options?: RequestInit) => {
			capturedBody = JSON.parse(options?.body as string)
			return new Response(JSON.stringify({ success: true }), { status: 200 })
		}

		await createMarkdownPage(mockConfig, {
			collection: 'blog',
			slug: 'post-with-meta',
			title: 'Post with Meta',
			frontmatter: {
				author: 'John Doe',
				tags: ['tech', 'programming'],
			},
		})

		expect(capturedBody?.frontmatter).toEqual({
			author: 'John Doe',
			tags: ['tech', 'programming'],
		})
	})
})

describe('updateMarkdownPage', () => {
	test('sends POST request to /markdown/update endpoint', async () => {
		let capturedRequest: any = null
		;(global as any).fetch = async (url: string | Request, options?: RequestInit) => {
			capturedRequest = {
				url: url.toString(),
				body: JSON.parse(options?.body as string),
			}
			return new Response(JSON.stringify({ success: true }), { status: 200 })
		}

		await updateMarkdownPage(mockConfig, {
			filePath: '/content/blog/my-post.md',
			content: '# Updated Content',
		})

		expect(capturedRequest?.url).toBe('/_nua/cms/markdown/update')
		expect(capturedRequest?.body.filePath).toBe('/content/blog/my-post.md')
		expect(capturedRequest?.body.content).toBe('# Updated Content')
	})

	test('returns success response', async () => {
		;(global as any).fetch = async () => {
			return new Response(
				JSON.stringify({
					success: true,
					commit: 'abc123',
					commitMessage: 'Update blog post',
				}),
				{ status: 200 },
			)
		}

		const result = await updateMarkdownPage(mockConfig, {
			filePath: '/content/blog/my-post.md',
			content: '# New Content',
		})

		expect(result.success).toBe(true)
		expect(result.commit).toBe('abc123')
	})

	test('returns error response on failure', async () => {
		;(global as any).fetch = async () => {
			return new Response('File not found', { status: 404, statusText: 'Not Found' })
		}

		const result = await updateMarkdownPage(mockConfig, {
			filePath: '/content/blog/nonexistent.md',
			content: '# Content',
		})

		expect(result.success).toBe(false)
		expect(result.error).toContain('Update page failed (404)')
	})

	test('supports updating frontmatter', async () => {
		let capturedBody: any = null
		;(global as any).fetch = async (_url: string | Request, options?: RequestInit) => {
			capturedBody = JSON.parse(options?.body as string)
			return new Response(JSON.stringify({ success: true }), { status: 200 })
		}

		await updateMarkdownPage(mockConfig, {
			filePath: '/content/blog/my-post.md',
			frontmatter: { title: 'Updated Title', draft: false },
		})

		expect(capturedBody?.frontmatter).toEqual({ title: 'Updated Title', draft: false })
	})
})

describe('fetchMarkdownContent', () => {
	test('fetches markdown content from /markdown/content endpoint', async () => {
		let fetchedUrl = ''
		;(global as any).fetch = async (url: string | Request) => {
			fetchedUrl = url.toString()
			return new Response(
				JSON.stringify({
					content: '# Hello World\n\nThis is content.',
					frontmatter: { title: 'Hello World', date: '2024-01-01' },
				}),
				{ status: 200 },
			)
		}

		await fetchMarkdownContent(mockConfig, '/content/blog/my-post.md')

		expect(fetchedUrl).toBe('/_nua/cms/markdown/content?path=%2Fcontent%2Fblog%2Fmy-post.md')
	})

	test('returns content and frontmatter on success', async () => {
		;(global as any).fetch = async () => {
			return new Response(
				JSON.stringify({
					content: '# Test Post\n\nBody text here.',
					frontmatter: { title: 'Test Post', author: 'Jane' },
				}),
				{ status: 200 },
			)
		}

		const result = await fetchMarkdownContent(mockConfig, '/content/blog/test.md')

		expect(result?.content).toBe('# Test Post\n\nBody text here.')
		expect(result?.frontmatter.title).toBe('Test Post')
		expect(result?.frontmatter.author).toBe('Jane')
	})

	test('returns null on failure', async () => {
		;(global as any).fetch = async () => {
			return new Response('Not found', { status: 404 })
		}

		const result = await fetchMarkdownContent(mockConfig, '/content/blog/nonexistent.md')

		expect(result).toBeNull()
	})

	test('encodes file path in URL', async () => {
		let fetchedUrl = ''
		;(global as any).fetch = async (url: string | Request) => {
			fetchedUrl = url.toString()
			return new Response(JSON.stringify({ content: '', frontmatter: {} }), { status: 200 })
		}

		await fetchMarkdownContent(mockConfig, '/content/blog/post with spaces.md')

		expect(fetchedUrl).toContain('path=%2Fcontent%2Fblog%2Fpost%20with%20spaces.md')
	})
})

describe('fetchMediaLibrary', () => {
	test('fetches media list from /media/list endpoint', async () => {
		let fetchedUrl = ''
		;(global as any).fetch = async (url: string | Request) => {
			fetchedUrl = url.toString()
			return new Response(
				JSON.stringify({
					items: [],
					hasMore: false,
				}),
				{ status: 200 },
			)
		}

		await fetchMediaLibrary(mockConfig)

		expect(fetchedUrl).toBe('/_nua/cms/media/list?limit=50')
	})

	test('includes cursor when provided', async () => {
		let fetchedUrl = ''
		;(global as any).fetch = async (url: string | Request) => {
			fetchedUrl = url.toString()
			return new Response(JSON.stringify({ items: [], hasMore: false }), { status: 200 })
		}

		await fetchMediaLibrary(mockConfig, 'cursor123')

		expect(fetchedUrl).toBe('/_nua/cms/media/list?limit=50&cursor=cursor123')
	})

	test('respects custom limit', async () => {
		let fetchedUrl = ''
		;(global as any).fetch = async (url: string | Request) => {
			fetchedUrl = url.toString()
			return new Response(JSON.stringify({ items: [], hasMore: false }), { status: 200 })
		}

		await fetchMediaLibrary(mockConfig, undefined, 100)

		expect(fetchedUrl).toBe('/_nua/cms/media/list?limit=100')
	})

	test('returns media items', async () => {
		;(global as any).fetch = async () => {
			return new Response(
				JSON.stringify({
					items: [
						{ id: 'img-1', url: '/images/photo1.jpg', name: 'photo1.jpg', type: 'image/jpeg' },
						{ id: 'img-2', url: '/images/photo2.png', name: 'photo2.png', type: 'image/png' },
					],
					hasMore: true,
					cursor: 'next-cursor',
				}),
				{ status: 200 },
			)
		}

		const result = await fetchMediaLibrary(mockConfig)

		expect(result.items).toHaveLength(2)
		expect(result.items[0]?.id).toBe('img-1')
		expect(result.hasMore).toBe(true)
		expect(result.cursor).toBe('next-cursor')
	})

	test('throws error on failure', async () => {
		;(global as any).fetch = async () => {
			return new Response('Server error', { status: 500 })
		}

		await expect(fetchMediaLibrary(mockConfig)).rejects.toThrow('Failed to fetch media library (500)')
	})
})

describe('uploadMedia', () => {
	test('sends FormData to /media/upload endpoint', async () => {
		let capturedUrl = ''
		let capturedBody: any = null

		// Mock XMLHttpRequest
		const mockXhr = {
			upload: {
				addEventListener: () => {},
			},
			addEventListener: (event: string, handler: () => void) => {
				if (event === 'load') {
					setTimeout(() => {
						mockXhr.status = 200
						mockXhr.responseText = JSON.stringify({ success: true, url: '/images/uploaded.jpg' })
						handler()
					}, 0)
				}
			},
			open: (method: string, url: string) => {
				capturedUrl = url
			},
			send: (body: FormData) => {
				capturedBody = body
			},
			withCredentials: false,
			timeout: 0,
			status: 0,
			responseText: '',
		}

		// @ts-expect-error - mock constructor
		global.XMLHttpRequest = function() {
			return mockXhr
		}

		const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' })
		const result = await uploadMedia(mockConfig, file)

		expect(capturedUrl).toBe('/_nua/cms/media/upload')
		expect(capturedBody?.get('file')).toBe(file)
		expect(result.success).toBe(true)
	})

	test('calls progress callback', async () => {
		const progressValues: number[] = []

		const mockXhr = {
			upload: {
				addEventListener: (event: string, handler: (e: { lengthComputable: boolean; loaded: number; total: number }) => void) => {
					if (event === 'progress') {
						setTimeout(() => {
							handler({ lengthComputable: true, loaded: 50, total: 100 })
							handler({ lengthComputable: true, loaded: 100, total: 100 })
						}, 0)
					}
				},
			},
			addEventListener: (event: string, handler: () => void) => {
				if (event === 'load') {
					setTimeout(() => {
						mockXhr.status = 200
						mockXhr.responseText = JSON.stringify({ success: true })
						handler()
					}, 10)
				}
			},
			open: () => {},
			send: () => {},
			withCredentials: false,
			timeout: 0,
			status: 0,
			responseText: '',
		}

		// @ts-expect-error - mock constructor
		global.XMLHttpRequest = function() {
			return mockXhr
		}

		const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })
		await uploadMedia(mockConfig, file, percent => progressValues.push(percent))

		expect(progressValues).toContain(50)
		expect(progressValues).toContain(100)
	})

	test('returns error on HTTP failure', async () => {
		const mockXhr = {
			upload: { addEventListener: () => {} },
			addEventListener: (event: string, handler: () => void) => {
				if (event === 'load') {
					setTimeout(() => {
						mockXhr.status = 500
						mockXhr.statusText = 'Server Error'
						handler()
					}, 0)
				}
			},
			open: () => {},
			send: () => {},
			withCredentials: false,
			timeout: 0,
			status: 0,
			statusText: '',
			responseText: '',
		}

		// @ts-expect-error - mock constructor
		global.XMLHttpRequest = function() {
			return mockXhr
		}

		const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })
		const result = await uploadMedia(mockConfig, file)

		expect(result.success).toBe(false)
		expect(result.error).toContain('Upload failed (500)')
	})

	test('returns error on network failure', async () => {
		const mockXhr = {
			upload: { addEventListener: () => {} },
			addEventListener: (event: string, handler: () => void) => {
				if (event === 'error') {
					setTimeout(handler, 0)
				}
			},
			open: () => {},
			send: () => {},
			withCredentials: false,
			timeout: 0,
			status: 0,
			responseText: '',
		}

		// @ts-expect-error - mock constructor
		global.XMLHttpRequest = function() {
			return mockXhr
		}

		const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })
		const result = await uploadMedia(mockConfig, file)

		expect(result.success).toBe(false)
		expect(result.error).toBe('Network error during upload')
	})

	test('returns error on timeout', async () => {
		const mockXhr = {
			upload: { addEventListener: () => {} },
			addEventListener: (event: string, handler: () => void) => {
				if (event === 'timeout') {
					setTimeout(handler, 0)
				}
			},
			open: () => {},
			send: () => {},
			withCredentials: false,
			timeout: 0,
			status: 0,
			responseText: '',
		}

		// @ts-expect-error - mock constructor
		global.XMLHttpRequest = function() {
			return mockXhr
		}

		const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })
		const result = await uploadMedia(mockConfig, file)

		expect(result.success).toBe(false)
		expect(result.error).toBe('Upload timed out')
	})

	test('returns error for invalid JSON response', async () => {
		const mockXhr = {
			upload: { addEventListener: () => {} },
			addEventListener: (event: string, handler: () => void) => {
				if (event === 'load') {
					setTimeout(() => {
						mockXhr.status = 200
						mockXhr.responseText = 'not json'
						handler()
					}, 0)
				}
			},
			open: () => {},
			send: () => {},
			withCredentials: false,
			timeout: 0,
			status: 0,
			responseText: '',
		}

		// @ts-expect-error - mock constructor
		global.XMLHttpRequest = function() {
			return mockXhr
		}

		const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })
		const result = await uploadMedia(mockConfig, file)

		expect(result.success).toBe(false)
		expect(result.error).toBe('Invalid response format')
	})
})

describe('deleteMedia', () => {
	test('sends DELETE request to /media/:id endpoint', async () => {
		let capturedRequest: any = null
		;(global as any).fetch = async (url: string | Request, options?: RequestInit) => {
			capturedRequest = {
				url: url.toString(),
				method: options?.method || 'GET',
			}
			return new Response(JSON.stringify({ success: true }), { status: 200 })
		}

		await deleteMedia(mockConfig, 'media-123')

		expect(capturedRequest?.url).toBe('/_nua/cms/media/media-123')
		expect(capturedRequest?.method).toBe('DELETE')
	})

	test('returns success on successful delete', async () => {
		;(global as any).fetch = async () => {
			return new Response(JSON.stringify({ success: true }), { status: 200 })
		}

		const result = await deleteMedia(mockConfig, 'media-123')

		expect(result.success).toBe(true)
		expect(result.error).toBeUndefined()
	})

	test('returns error on failure', async () => {
		;(global as any).fetch = async () => {
			return new Response('Media not found', { status: 404, statusText: 'Not Found' })
		}

		const result = await deleteMedia(mockConfig, 'nonexistent')

		expect(result.success).toBe(false)
		expect(result.error).toContain('Delete failed (404)')
	})
})
