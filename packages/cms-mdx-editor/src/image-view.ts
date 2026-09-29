import { imageSchema } from '@milkdown/preset-commonmark'
import type { Node } from '@milkdown/prose/model'
import type { NodeView } from '@milkdown/prose/view'
import { $view } from '@milkdown/utils'
import { mediaPreviewSrc } from './media-preview'
import type { MediaContext, MediaSource } from './media-source'

/** Resolve only the preview DOM, never the document's stored/serialized src. */
export function imageNodeView(node: Node, media?: MediaSource, context?: MediaContext): NodeView {
	const dom = document.createElement('img')
	const render = (current: Node) => {
		const src = mediaPreviewSrc(media, current.attrs.src || '', context)
		if (src) dom.setAttribute('src', src)
		else dom.removeAttribute('src')
		dom.alt = current.attrs.alt || ''
		dom.title = current.attrs.title || ''
	}
	render(node)
	return {
		dom,
		update(next) {
			if (next.type !== node.type) return false
			render(next)
			return true
		},
		// Re-reading the preview URL as document content would persist an authenticated
		// editor endpoint into the public article. All edits flow through node attrs.
		ignoreMutation: () => true,
	}
}

export function createImageView(media?: MediaSource, context?: MediaContext) {
	return $view(imageSchema.node, () => node => imageNodeView(node, media, context))
}
