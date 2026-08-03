import { mediaPreviewSrc } from '@nuasite/cms-mdx-editor'
import { describe, expect, test } from 'bun:test'
import type { MediaSource } from '../src/media-source'

const CONTEXT = { collection: 'posts', entry: 'hello-world' }

/** A host whose project is served from somewhere else — the webmaster BFF shape. */
const resolving: MediaSource = {
	listMedia: async () => ({ items: [], folders: [], hasMore: false }),
	uploadMedia: async () => ({ success: true }),
	mediaAssetUrl: path => `https://app.test/bff/assets?path=${encodeURIComponent(path)}`,
	mediaFileUrl: (collection, entry, path) => `https://app.test/bff/${collection}/${entry}/file?path=${encodeURIComponent(path)}`,
}

/** A host that serves the project from the editor's own origin: no builders needed. */
const plain: MediaSource = {
	listMedia: async () => ({ items: [], folders: [], hasMore: false }),
	uploadMedia: async () => ({ success: true }),
}

describe('mediaPreviewSrc', () => {
	test('a value carrying its own origin loads as written', () => {
		for (const value of ['https://cdn.test/assets/x/abc-hero.webp', 'http://cdn.test/hero.png', '//cdn.test/hero.png', 'data:image/png;base64,AAAA']) {
			expect({ value, src: mediaPreviewSrc(resolving, value, CONTEXT) }).toEqual({ value, src: value })
		}
	})

	test('a root-relative repository path goes through the asset builder', () => {
		// The bare path is what used to be rendered, and the host answers it with its own SPA
		// shell — a broken image in every project. This is the whole point of the fix.
		expect(mediaPreviewSrc(resolving, '/uploads/hero.webp', CONTEXT))
			.toBe('https://app.test/bff/assets?path=%2Fuploads%2Fhero.webp')
	})

	test('an entry-relative path goes through the file builder', () => {
		expect(mediaPreviewSrc(resolving, '../../src/assets/hero.webp', CONTEXT))
			.toBe('https://app.test/bff/posts/hello-world/file?path=..%2F..%2Fsrc%2Fassets%2Fhero.webp')
		expect(mediaPreviewSrc(resolving, './hero.webp', CONTEXT))
			.toBe('https://app.test/bff/posts/hello-world/file?path=.%2Fhero.webp')
	})

	test('an entry-relative path has no preview without the owning entry', () => {
		// Creating an entry: no slug exists yet, so nothing can resolve the path.
		expect(mediaPreviewSrc(resolving, '../../src/assets/hero.webp', { collection: 'posts' })).toBe('')
		expect(mediaPreviewSrc(resolving, '../../src/assets/hero.webp', undefined)).toBe('')
		// A root-relative value still previews there — it needs no entry.
		expect(mediaPreviewSrc(resolving, '/uploads/hero.webp', { collection: 'posts' }))
			.toBe('https://app.test/bff/assets?path=%2Fuploads%2Fhero.webp')
	})

	test('a host without the builders keeps loading root-relative values directly', () => {
		// Both builders are optional, so a same-origin host must behave exactly as before.
		expect(mediaPreviewSrc(plain, '/uploads/hero.webp', CONTEXT)).toBe('/uploads/hero.webp')
		expect(mediaPreviewSrc(undefined, '/uploads/hero.webp', CONTEXT)).toBe('/uploads/hero.webp')
		expect(mediaPreviewSrc(undefined, 'https://cdn.test/hero.png', CONTEXT)).toBe('https://cdn.test/hero.png')
		// An entry-relative path resolves against the entry's source dir, never against the
		// editor's URL, so without a builder there is nothing to show.
		expect(mediaPreviewSrc(plain, '../../src/assets/hero.webp', CONTEXT)).toBe('')
	})

	test('an empty value has no preview', () => {
		expect(mediaPreviewSrc(resolving, '', CONTEXT)).toBe('')
	})
})
