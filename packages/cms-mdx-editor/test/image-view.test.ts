import { expect, test } from 'bun:test'
import { Schema } from '@milkdown/prose/model'
import { imageNodeView } from '../src/image-view'
import type { MediaSource } from '../src/media-source'

const schema = new Schema({ nodes: {
	doc: { content: 'image*' }, text: {},
	image: { attrs: { src: {}, alt: { default: '' }, title: { default: '' } } },
} })
const media: MediaSource = {
	listMedia: async () => ({ items: [], folders: [], hasMore: false }),
	uploadMedia: async () => ({ success: true }),
	mediaAssetUrl: path => `/cms/v1/media/asset?path=${encodeURIComponent(path)}`,
	mediaFileUrl: (collection, entry, path) => `/cms/v1/${collection}/${entry}?path=${encodeURIComponent(path)}`,
}

test('project images preview through the media API while the document retains its public path', () => {
	const node = schema.nodes.image.create({ src: '/uploads/photo.jpg', alt: 'Our lab' })
	const view = imageNodeView(node, media)
	expect((view.dom as HTMLImageElement).getAttribute('src')).toBe('/cms/v1/media/asset?path=%2Fuploads%2Fphoto.jpg')
	expect(node.attrs.src).toBe('/uploads/photo.jpg')
	expect((view.dom as HTMLImageElement).alt).toBe('Our lab')
	const next = schema.nodes.image.create({ src: 'https://example.com/photo.jpg', alt: 'New image' })
	expect(view.update!(next, [], {} as never)).toBe(true)
	expect((view.dom as HTMLImageElement).src).toBe('https://example.com/photo.jpg')
	expect(next.attrs.src).toBe('https://example.com/photo.jpg')
	expect(view.ignoreMutation!({} as never)).toBe(true)
})

test('entry-relative images use context; same-origin and empty values remain supported', () => {
	const relative = schema.nodes.image.create({ src: './photo.jpg' })
	expect((imageNodeView(relative, media, { collection: 'news', entry: 'paper' }).dom as HTMLElement).getAttribute('src')).toBe('/cms/v1/news/paper?path=.%2Fphoto.jpg')
	const local = schema.nodes.image.create({ src: '/uploads/photo.jpg' })
	expect((imageNodeView(local).dom as HTMLElement).getAttribute('src')).toBe('/uploads/photo.jpg')
	expect((imageNodeView(schema.nodes.image.create({ src: '' }), media).dom as HTMLElement).hasAttribute('src')).toBe(false)
})
