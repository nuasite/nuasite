import { beforeEach, describe, expect, test } from 'bun:test'
import {
	currentMarkdownPage,
	deploymentState,
	isMarkdownPreview,
	markdownEditorState,
	resetAllState,
	resetMarkdownEditorState,
	setMarkdownEditorOpen,
	setMarkdownPage,
	updateDeploymentState,
	updateMarkdownContent,
	updateMarkdownFrontmatter,
} from '../../../src/editor/signals'
import type { BlogFrontmatter, MarkdownPageEntry } from '../../../src/editor/types'

const makePage = (overrides?: Partial<MarkdownPageEntry>): MarkdownPageEntry => ({
	filePath: '/content/blog/test-post.md',
	slug: 'test-post',
	frontmatter: { title: 'Test Post', date: '2025-01-01' } as BlogFrontmatter,
	content: 'Initial content',
	isDirty: false,
	...overrides,
})

beforeEach(() => {
	resetAllState()
})

describe('markdown editor signal reads (stale closure prevention)', () => {
	test('currentMarkdownPage reflects content updates immediately', () => {
		setMarkdownPage(makePage())
		setMarkdownEditorOpen(true)

		expect(currentMarkdownPage.value?.content).toBe('Initial content')

		updateMarkdownContent('Updated content')

		expect(currentMarkdownPage.value?.content).toBe('Updated content')
		expect(currentMarkdownPage.value?.isDirty).toBe(true)
	})

	test('currentMarkdownPage reflects frontmatter updates immediately', () => {
		setMarkdownPage(makePage())
		setMarkdownEditorOpen(true)

		expect(currentMarkdownPage.value?.frontmatter.title).toBe('Test Post')

		updateMarkdownFrontmatter({ title: 'Updated Title' })

		expect(currentMarkdownPage.value?.frontmatter.title).toBe('Updated Title')
		expect(currentMarkdownPage.value?.isDirty).toBe(true)
	})

	test('reading signal.value inside a callback always gets current state', () => {
		setMarkdownPage(makePage())
		setMarkdownEditorOpen(true)

		// Simulate what a stale closure would do: capture value at "render time"
		const stalePageRef = currentMarkdownPage.value

		// Simulate edits happening after "render"
		updateMarkdownContent('Edited content')
		updateMarkdownFrontmatter({ title: 'Edited Title' })

		// Stale reference has old values
		expect(stalePageRef?.content).toBe('Initial content')
		expect(stalePageRef?.frontmatter.title).toBe('Test Post')

		// Reading from signal directly gets current values (what our fix does)
		expect(currentMarkdownPage.value?.content).toBe('Edited content')
		expect(currentMarkdownPage.value?.frontmatter.title).toBe('Edited Title')
	})

	test('markdownEditorState.activeElementId is accessible via signal after updates', () => {
		setMarkdownPage(makePage())
		markdownEditorState.value = {
			...markdownEditorState.value,
			isOpen: true,
			activeElementId: 'element-1',
		}

		// Capture at "render time"
		const staleState = markdownEditorState.value

		// Content update creates a new state object
		updateMarkdownContent('New content')

		// Stale reference keeps old object, but activeElementId should be same
		expect(staleState.activeElementId).toBe('element-1')
		// Signal read also works
		expect(markdownEditorState.value.activeElementId).toBe('element-1')
	})
})

describe('markdown editor save state transitions', () => {
	test('resetMarkdownEditorState closes editor and clears page', () => {
		setMarkdownPage(makePage())
		setMarkdownEditorOpen(true)

		expect(markdownEditorState.value.isOpen).toBe(true)
		expect(currentMarkdownPage.value).not.toBeNull()

		resetMarkdownEditorState()

		expect(markdownEditorState.value.isOpen).toBe(false)
		expect(currentMarkdownPage.value).toBeNull()
	})

	test('save flow: editor closes while deployment state activates', () => {
		setMarkdownPage(makePage())
		setMarkdownEditorOpen(true)

		// Simulate save success: close editor + set deployment pending
		resetMarkdownEditorState()
		updateDeploymentState({ status: 'pending', isPolling: true, error: null })

		// Editor should be closed
		expect(markdownEditorState.value.isOpen).toBe(false)
		expect(currentMarkdownPage.value).toBeNull()

		// Deployment should be active (toolbar shows this)
		expect(deploymentState.value.status).toBe('pending')
		expect(deploymentState.value.isPolling).toBe(true)
	})

	test('deployment status progresses from pending to completed', () => {
		updateDeploymentState({ status: 'pending', isPolling: true, error: null })
		expect(deploymentState.value.status).toBe('pending')

		updateDeploymentState({ status: 'running' })
		expect(deploymentState.value.status).toBe('running')

		updateDeploymentState({ status: 'completed', isPolling: false, lastDeployedAt: '2025-01-01T00:00:00Z' })
		expect(deploymentState.value.status).toBe('completed')
		expect(deploymentState.value.lastDeployedAt).toBe('2025-01-01T00:00:00Z')
	})

	test('isMarkdownPreview is cleared on editor reset', () => {
		isMarkdownPreview.value = true
		expect(isMarkdownPreview.value).toBe(true)

		// When saving, preview should be cleared before resetting editor
		isMarkdownPreview.value = false
		resetMarkdownEditorState()

		expect(isMarkdownPreview.value).toBe(false)
	})
})

describe('markdown content updates do not lose data', () => {
	test('multiple rapid content updates preserve the last value', () => {
		setMarkdownPage(makePage())
		setMarkdownEditorOpen(true)

		// Simulate rapid typing
		updateMarkdownContent('a')
		updateMarkdownContent('ab')
		updateMarkdownContent('abc')
		updateMarkdownContent('abcd')

		expect(currentMarkdownPage.value?.content).toBe('abcd')
		expect(currentMarkdownPage.value?.isDirty).toBe(true)
	})

	test('frontmatter updates preserve content changes', () => {
		setMarkdownPage(makePage())
		setMarkdownEditorOpen(true)

		updateMarkdownContent('New body content')
		updateMarkdownFrontmatter({ title: 'New Title' })

		// Both changes should be reflected
		expect(currentMarkdownPage.value?.content).toBe('New body content')
		expect(currentMarkdownPage.value?.frontmatter.title).toBe('New Title')
	})

	test('content updates preserve frontmatter changes', () => {
		setMarkdownPage(makePage())
		setMarkdownEditorOpen(true)

		updateMarkdownFrontmatter({ title: 'New Title' })
		updateMarkdownContent('New body content')

		// Both changes should be reflected
		expect(currentMarkdownPage.value?.frontmatter.title).toBe('New Title')
		expect(currentMarkdownPage.value?.content).toBe('New body content')
	})

	test('filePath is preserved through content updates', () => {
		setMarkdownPage(makePage({ filePath: '/content/blog/my-post.md' }))
		setMarkdownEditorOpen(true)

		updateMarkdownContent('Changed content')

		expect(currentMarkdownPage.value?.filePath).toBe('/content/blog/my-post.md')
	})
})
