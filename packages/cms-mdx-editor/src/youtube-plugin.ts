/**
 * Milkdown node for YouTube embeds. The editor emits the directive `::youtube{#id}`
 * (a leaf directive — single line, no closing fence, parse-safe for every 11-char
 * video id including those starting with a digit). Older `:::youtube{id}` content
 * (bare attribute, only ever worked for letter-first ids) is still read back.
 *
 * Why a dedicated node rather than literal text: under remark-mdx a literal `{` in a
 * text node is escaped to `\{` on serialize, which would corrupt the directive. A node
 * with a custom directive serializer (see `remarkYoutubeDirectivePlugin`) round-trips
 * `::youtube{#id}` verbatim.
 */
import type { Node as PmNode } from '@milkdown/prose/model'
import type { Command } from '@milkdown/prose/state'
import type { MarkdownNode, Root, SerializerState } from '@milkdown/transformer'
import { $command, $node, $remark } from '@milkdown/utils'
import type { Plugin } from 'unified'

export const YOUTUBE_DIRECTIVE_NAME = 'youtube'

interface DirectiveMarkdownNode extends MarkdownNode {
	name?: unknown
	attributes?: unknown
}

/**
 * Pull the video id out of a parsed youtube directive's attributes. Handles the
 * emitted `{#id}` form (→ `{ id: '<value>' }`), the legacy bare `{id}` form (→ a single
 * empty-valued key) and the explicit `{id=…}` form.
 */
function videoIdFromAttributes(attributes: unknown): string {
	if (!attributes || typeof attributes !== 'object') return ''
	const entries = Object.entries(attributes)
	const id = (attributes as Record<string, unknown>).id
	if (typeof id === 'string' && id) return id
	for (const [key, value] of entries) {
		if (value === '' || value == null) return key
	}
	return ''
}

export const youtubeNode = $node('youtube', () => ({
	group: 'block',
	atom: true,
	isolating: true,
	selectable: true,
	draggable: false,
	attrs: {
		videoId: { default: '' },
	},
	// Array DOMOutputSpec rather than a DOM node: the latter trips up consumers whose
	// TS lib redefines the global `Node` (e.g. Cloudflare Workers types in webmaster).
	toDOM: (node: PmNode) => ['div', { 'data-youtube': node.attrs.videoId, class: 'youtube-block' }],
	parseDOM: [{
		tag: 'div[data-youtube]',
		getAttrs: (dom: HTMLElement) => ({ videoId: dom.getAttribute('data-youtube') || '' }),
	}],
	parseMarkdown: {
		match: (node: MarkdownNode) =>
			(node.type === 'leafDirective' || node.type === 'containerDirective' || node.type === 'textDirective')
			&& (node as DirectiveMarkdownNode).name === YOUTUBE_DIRECTIVE_NAME,
		runner: (state, node, proseType) => {
			const videoId = videoIdFromAttributes((node as DirectiveMarkdownNode).attributes)
			state.addNode(proseType, { videoId })
		},
	},
	toMarkdown: {
		match: (node: PmNode) => node.type.name === 'youtube',
		runner: (state: SerializerState, node: PmNode) => {
			state.addNode('leafDirective', undefined, undefined, {
				name: YOUTUBE_DIRECTIVE_NAME,
				attributes: { id: node.attrs.videoId as string },
			})
		},
	},
}))

// Serializes the `leafDirective` emitted above as `::youtube{#id}`. Registered as a
// custom handler (we don't load `directiveToMarkdown`, whose `unsafe` rules would
// escape `:` in prose); the handler's output is used verbatim, so the braces survive.
function youtubeLeafHandler(node: DirectiveMarkdownNode): string {
	const attrs = node.attributes
	const id = attrs && typeof attrs === 'object' ? String((attrs as Record<string, unknown>).id ?? '') : ''
	return `::${YOUTUBE_DIRECTIVE_NAME}{#${id}}`
}

// Mirrors `remarkListDirective`'s registration of a custom directive handler; the cast
// is needed because `leafDirective` isn't a key of the base mdast-util-to-markdown
// `Handlers` type (it's added by mdast-util-directive's module augmentation).
const remarkYoutubeDirective: Plugin<[], Root> = function() {
	const extensions = this.data('toMarkdownExtensions') ?? []
	const youtubeExtension = {
		handlers: { leafDirective: youtubeLeafHandler },
	} as unknown as (typeof extensions)[number]
	extensions.push(youtubeExtension)
	this.data('toMarkdownExtensions', extensions)
}

export const remarkYoutubeDirectivePlugin = $remark('remarkYoutubeDirective', () => remarkYoutubeDirective)

export const insertYoutubeCommand = $command('insertYoutube', () => {
	return (videoId?: string): Command => {
		return (state, dispatch) => {
			if (!videoId) return false
			const nodeType = state.schema.nodes.youtube
			if (!nodeType) return false
			const node = nodeType.create({ videoId })
			if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView())
			return true
		}
	}
})
