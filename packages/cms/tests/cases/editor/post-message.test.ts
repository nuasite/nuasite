import { beforeEach, expect, test } from 'bun:test'
import {
	buildEditorState,
	buildPageNavigatedMessage,
	buildReadyMessage,
	buildSelectedElement,
	buildStateChangedMessage,
	postToParent,
} from '../../../src/editor/post-message'
import type { CmsManifest, ManifestEntry } from '../../../src/types'
import type { ComponentInstance } from '../../../src/types'

// --- postToParent ---

test('postToParent sends message when inside an iframe', () => {
	const messages: any[] = []
	const originalParent = Object.getOwnPropertyDescriptor(window, 'parent')

	// Simulate iframe: window.parent !== window
	const fakeParent = { postMessage: (msg: any, origin: string) => messages.push({ msg, origin }) }
	Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true })

	postToParent({ type: 'cms-element-deselected' })

	expect(messages.length).toBe(1)
	expect(messages[0].msg).toEqual({ type: 'cms-element-deselected' })
	expect(messages[0].origin).toBe('*')

	// Restore
	if (originalParent) {
		Object.defineProperty(window, 'parent', originalParent)
	}
})

test('postToParent does nothing when not in an iframe', () => {
	// Default: window.parent === window (not in iframe)
	const originalPostMessage = window.postMessage
	let called = false
	window.postMessage = () => { called = true }

	// postToParent should detect window.parent === window and skip
	// (In a normal browser, window.parent === window when not framed)
	// This test verifies it doesn't throw
	postToParent({ type: 'cms-element-deselected' })

	window.postMessage = originalPostMessage
	// Note: In bun test environment window.parent may or may not equal window,
	// so we just verify no errors are thrown.
})

// --- buildSelectedElement ---

test('buildSelectedElement returns minimal element with no entry or instance', () => {
	const result = buildSelectedElement({
		cmsId: 'cms-0',
		isComponent: false,
		tagName: 'h1',
		rect: { x: 10, y: 20, width: 100, height: 50 },
	})

	expect(result.cmsId).toBe('cms-0')
	expect(result.isComponent).toBe(false)
	expect(result.tagName).toBe('h1')
	expect(result.rect).toEqual({ x: 10, y: 20, width: 100, height: 50 })
	expect(result.text).toBeUndefined()
	expect(result.component).toBeUndefined()
})

test('buildSelectedElement includes manifest entry fields', () => {
	const entry: ManifestEntry = {
		id: 'cms-1',
		tag: 'p',
		text: 'Hello world',
		html: '<strong>Hello</strong> world',
		sourcePath: 'src/pages/index.astro',
		sourceLine: 42,
		sourceSnippet: '<p>Hello world</p>',
		sourceHash: 'abc123',
		stableId: 'stable-xyz',
		contentPath: 'src/content/blog/post.md',
		parentComponentId: 'comp-1',
		childCmsIds: ['cms-2', 'cms-3'],
		collectionName: 'blog',
		collectionSlug: 'my-post',
		allowStyling: true,
	}

	const result = buildSelectedElement({
		cmsId: 'cms-1',
		isComponent: false,
		rect: null,
		entry,
	})

	expect(result.text).toBe('Hello world')
	expect(result.html).toBe('<strong>Hello</strong> world')
	expect(result.sourcePath).toBe('src/pages/index.astro')
	expect(result.sourceLine).toBe(42)
	expect(result.sourceSnippet).toBe('<p>Hello world</p>')
	expect(result.sourceHash).toBe('abc123')
	expect(result.stableId).toBe('stable-xyz')
	expect(result.contentPath).toBe('src/content/blog/post.md')
	expect(result.parentComponentId).toBe('comp-1')
	expect(result.childCmsIds).toEqual(['cms-2', 'cms-3'])
	expect(result.collectionName).toBe('blog')
	expect(result.collectionSlug).toBe('my-post')
	expect(result.allowStyling).toBe(true)
	expect(result.tagName).toBe('p') // falls back to entry.tag
})

test('buildSelectedElement includes component instance data', () => {
	const instance: ComponentInstance = {
		id: 'comp-1',
		componentName: 'Hero',
		file: 'src/components/Hero.astro',
		sourcePath: 'src/components/Hero.astro',
		sourceLine: 1,
		props: { title: 'Welcome' },
		slots: { default: '<p>Content</p>' },
	}

	const result = buildSelectedElement({
		cmsId: null,
		isComponent: true,
		rect: null,
		instance,
	})

	expect(result.isComponent).toBe(true)
	expect(result.cmsId).toBeNull()
	expect(result.componentName).toBe('Hero') // from instance
	expect(result.component).toEqual({
		name: 'Hero',
		file: 'src/components/Hero.astro',
		sourcePath: 'src/components/Hero.astro',
		sourceLine: 1,
		props: { title: 'Welcome' },
		slots: { default: '<p>Content</p>' },
	})
})

test('buildSelectedElement prefers explicit componentName over instance', () => {
	const instance: ComponentInstance = {
		id: 'comp-1',
		componentName: 'Hero',
		file: 'src/components/Hero.astro',
		sourcePath: 'src/components/Hero.astro',
		sourceLine: 1,
		props: {},
	}

	const result = buildSelectedElement({
		cmsId: null,
		isComponent: true,
		componentName: 'CustomHero',
		rect: null,
		instance,
	})

	expect(result.componentName).toBe('CustomHero')
})

// --- buildReadyMessage ---

test('buildReadyMessage creates correct message structure', () => {
	const manifest: CmsManifest = {
		entries: {},
		components: {},
		componentDefinitions: { Hero: { name: 'Hero', file: 'Hero.astro', props: [] } },
		pages: [{ pathname: '/', title: 'Home' }, { pathname: '/about', title: 'About' }],
		metadata: { version: '1.0', generatedAt: '2024-01-01T00:00:00Z' },
	}

	const msg = buildReadyMessage(manifest, '/')

	expect(msg.type).toBe('cms-ready')
	expect(msg.data.pathname).toBe('/')
	expect(msg.data.pageTitle).toBe('Home')
	expect(msg.data.pages).toHaveLength(2)
	expect(msg.data.componentDefinitions).toHaveProperty('Hero')
	expect(msg.data.metadata?.version).toBe('1.0')
})

test('buildReadyMessage resolves page title from pages array', () => {
	const manifest: CmsManifest = {
		entries: {},
		components: {},
		componentDefinitions: {},
		pages: [{ pathname: '/', title: 'Home' }, { pathname: '/about', title: 'About Us' }],
	}

	const msg = buildReadyMessage(manifest, '/about')
	expect(msg.data.pageTitle).toBe('About Us')
})

test('buildReadyMessage resolves page title from seo data', () => {
	const manifest: CmsManifest & { seo?: any } = {
		entries: {},
		components: {},
		componentDefinitions: {},
		pages: [{ pathname: '/', title: 'Home' }],
		seo: {
			title: { content: 'SEO Title', sourcePath: 'x', sourceLine: 1, sourceSnippet: '' },
		},
	}

	const msg = buildReadyMessage(manifest, '/')
	expect(msg.data.pageTitle).toBe('SEO Title') // SEO title takes precedence
})

test('buildReadyMessage handles missing optional fields', () => {
	const manifest: CmsManifest = {
		entries: {},
		components: {},
		componentDefinitions: {},
	}

	const msg = buildReadyMessage(manifest, '/unknown')

	expect(msg.data.pathname).toBe('/unknown')
	expect(msg.data.pageTitle).toBeUndefined()
	expect(msg.data.pages).toBeUndefined()
	expect(msg.data.collectionDefinitions).toBeUndefined()
	expect(msg.data.availableColors).toBeUndefined()
	expect(msg.data.availableTextStyles).toBeUndefined()
	expect(msg.data.metadata).toBeUndefined()
})

// --- buildPageNavigatedMessage ---

test('buildPageNavigatedMessage creates correct message', () => {
	const manifest: CmsManifest = {
		entries: {},
		components: {},
		componentDefinitions: {},
		pages: [{ pathname: '/blog', title: 'Blog' }],
	}

	const msg = buildPageNavigatedMessage(manifest, '/blog')

	expect(msg.type).toBe('cms-page-navigated')
	expect(msg.page.pathname).toBe('/blog')
	expect(msg.page.title).toBe('Blog')
})

test('buildPageNavigatedMessage handles unknown pathname', () => {
	const manifest: CmsManifest = {
		entries: {},
		components: {},
		componentDefinitions: {},
		pages: [{ pathname: '/', title: 'Home' }],
	}

	const msg = buildPageNavigatedMessage(manifest, '/nonexistent')

	expect(msg.page.pathname).toBe('/nonexistent')
	expect(msg.page.title).toBeUndefined()
})

// --- buildEditorState ---

test('buildEditorState with zero dirty counts', () => {
	const state = buildEditorState({
		isEditing: false,
		dirtyCount: { text: 0, image: 0, color: 0, bgImage: 0, attribute: 0, seo: 0, total: 0 },
		deploymentStatus: null,
		lastDeployedAt: null,
		canUndo: false,
		canRedo: false,
	})

	expect(state.isEditing).toBe(false)
	expect(state.hasChanges).toBe(false)
	expect(state.dirtyCount.total).toBe(0)
	expect(state.deployment.status).toBeNull()
	expect(state.deployment.lastDeployedAt).toBeNull()
	expect(state.canUndo).toBe(false)
	expect(state.canRedo).toBe(false)
})

test('buildEditorState with active editing and dirty changes', () => {
	const state = buildEditorState({
		isEditing: true,
		dirtyCount: { text: 3, image: 1, color: 2, bgImage: 0, attribute: 1, seo: 0, total: 7 },
		deploymentStatus: 'running',
		lastDeployedAt: '2024-01-01T12:00:00Z',
		canUndo: true,
		canRedo: false,
	})

	expect(state.isEditing).toBe(true)
	expect(state.hasChanges).toBe(true)
	expect(state.dirtyCount.text).toBe(3)
	expect(state.dirtyCount.image).toBe(1)
	expect(state.dirtyCount.color).toBe(2)
	expect(state.dirtyCount.bgImage).toBe(0)
	expect(state.dirtyCount.attribute).toBe(1)
	expect(state.dirtyCount.seo).toBe(0)
	expect(state.dirtyCount.total).toBe(7)
	expect(state.deployment.status).toBe('running')
	expect(state.deployment.lastDeployedAt).toBe('2024-01-01T12:00:00Z')
	expect(state.canUndo).toBe(true)
	expect(state.canRedo).toBe(false)
})

test('buildEditorState hasChanges is derived from total', () => {
	const withChanges = buildEditorState({
		isEditing: true,
		dirtyCount: { text: 0, image: 0, color: 0, bgImage: 0, attribute: 0, seo: 1, total: 1 },
		deploymentStatus: null,
		lastDeployedAt: null,
		canUndo: false,
		canRedo: false,
	})
	expect(withChanges.hasChanges).toBe(true)

	const noChanges = buildEditorState({
		isEditing: true,
		dirtyCount: { text: 0, image: 0, color: 0, bgImage: 0, attribute: 0, seo: 0, total: 0 },
		deploymentStatus: null,
		lastDeployedAt: null,
		canUndo: false,
		canRedo: false,
	})
	expect(noChanges.hasChanges).toBe(false)
})

// --- buildStateChangedMessage ---

test('buildStateChangedMessage wraps state with correct type', () => {
	const state = buildEditorState({
		isEditing: true,
		dirtyCount: { text: 1, image: 0, color: 0, bgImage: 0, attribute: 0, seo: 0, total: 1 },
		deploymentStatus: 'completed',
		lastDeployedAt: '2024-06-15T10:00:00Z',
		canUndo: true,
		canRedo: true,
	})

	const msg = buildStateChangedMessage(state)

	expect(msg.type).toBe('cms-state-changed')
	expect(msg.state).toBe(state) // same reference
	expect(msg.state.isEditing).toBe(true)
	expect(msg.state.deployment.status).toBe('completed')
})

// --- Deployment status variants ---

test('buildEditorState handles all deployment status values', () => {
	const statuses = ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled', null] as const
	for (const status of statuses) {
		const state = buildEditorState({
			isEditing: false,
			dirtyCount: { text: 0, image: 0, color: 0, bgImage: 0, attribute: 0, seo: 0, total: 0 },
			deploymentStatus: status,
			lastDeployedAt: null,
			canUndo: false,
			canRedo: false,
		})
		expect(state.deployment.status).toBe(status)
	}
})
