import { describe, expect, test } from 'bun:test'
import { looksLikeImage, mediaPreviewSrc, type MediaUrlBuilder } from '../src/media'

const base = '/app/project/acme/session/s1/cms'

const client: MediaUrlBuilder = {
	mediaFileUrl: (collection, entry, path) => `${base}/collections/${collection}/entries/${entry}/asset?path=${encodeURIComponent(path)}`,
	mediaAssetUrl: path => `${base}/asset?path=${encodeURIComponent(path)}`,
}

describe('mediaPreviewSrc', () => {
	test('an empty value has no preview', () => {
		expect(mediaPreviewSrc(client, '', 'articles', 'hello')).toBe('')
		expect(mediaPreviewSrc(client, '', 'articles', undefined)).toBe('')
	})

	test('a value that carries its own origin loads directly', () => {
		expect(mediaPreviewSrc(client, 'https://cdn.nuasite.com/assets/acme/abc.webp', 'articles', 'hello'))
			.toBe('https://cdn.nuasite.com/assets/acme/abc.webp')
		expect(mediaPreviewSrc(client, 'http://example.com/a.png', 'articles', undefined)).toBe('http://example.com/a.png')
		expect(mediaPreviewSrc(client, '//example.com/a.png', 'articles', undefined)).toBe('//example.com/a.png')
		expect(mediaPreviewSrc(client, 'data:image/png;base64,AAA', 'articles', undefined)).toBe('data:image/png;base64,AAA')
	})

	test('a root-relative repository path goes through the sidecar, not the host origin', () => {
		expect(mediaPreviewSrc(client, '/uploads/hero.webp', 'articles', 'hello')).toBe(`${base}/asset?path=%2Fuploads%2Fhero.webp`)
		expect(mediaPreviewSrc(client, '/assets/photo.jpg', 'articles', 'hello')).toBe(`${base}/asset?path=%2Fassets%2Fphoto.jpg`)
	})

	test('a root-relative path also previews in create mode, where there is no entry yet', () => {
		expect(mediaPreviewSrc(client, '/uploads/hero.webp', 'articles', undefined)).toBe(`${base}/asset?path=%2Fuploads%2Fhero.webp`)
	})

	test('an entry-relative path resolves against the owning entry', () => {
		expect(mediaPreviewSrc(client, '../../src/assets/hero.webp', 'articles', 'hello'))
			.toBe(`${base}/collections/articles/entries/hello/asset?path=..%2F..%2Fsrc%2Fassets%2Fhero.webp`)
		expect(mediaPreviewSrc(client, './cover.png', 'articles', 'hello'))
			.toBe(`${base}/collections/articles/entries/hello/asset?path=.%2Fcover.png`)
	})

	test('an entry-relative path has no preview in create mode — it needs the slug', () => {
		expect(mediaPreviewSrc(client, '../../src/assets/hero.webp', 'articles', undefined)).toBe('')
	})
})

describe('looksLikeImage', () => {
	test('accepts image extensions, with a query or hash', () => {
		expect(looksLikeImage('/uploads/hero.webp')).toBe(true)
		expect(looksLikeImage('https://cdn.nuasite.com/a/b.JPEG')).toBe(true)
		expect(looksLikeImage('/uploads/hero.png?v=2')).toBe(true)
		expect(looksLikeImage('/uploads/hero.svg#icon')).toBe(true)
		expect(looksLikeImage('data:image/png;base64,AAA')).toBe(true)
	})

	test('rejects non-image values so `file` fields show no thumbnail', () => {
		expect(looksLikeImage('')).toBe(false)
		expect(looksLikeImage('/uploads/manual.pdf')).toBe(false)
		expect(looksLikeImage('data:application/pdf;base64,AAA')).toBe(false)
	})
})
