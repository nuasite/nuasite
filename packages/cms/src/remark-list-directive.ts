import type { Plugin } from 'unified'

// Render-side counterpart of the editor's directive plugins
// (packages/cms-mdx-editor/src/{styled-list,youtube}-plugin.ts). The editor
// serializes a styled list as `:::list{.className}` and a YouTube embed as the leaf
// directive `::youtube{#id}`. On the site we need `remark-directive` to claim that
// syntax before MDX would otherwise treat `{…}` as a JSX expression and crash acorn.
// This plugin then:
//   - turns the `list` directive into a plain `<ul class="className">`,
//   - turns the `youtube` directive into an `<iframe class="youtube-embed">` the site
//     styles (mirrors the list pattern: framework emits the element, site owns CSS),
//   - converts every OTHER directive back to its literal source text, so a stray colon
//     in prose (e.g. `klíč:hodnota` → a `:hodnota` text directive) is never silently
//     dropped by remark-rehype.

const LIST_DIRECTIVE_NAME = 'list'
const YOUTUBE_DIRECTIVE_NAME = 'youtube'
const LIST_STYLE_CLASS_RE = /^[A-Za-z0-9_-]+$/
const VIDEO_ID_RE = /^[A-Za-z0-9_-]+$/
const DIRECTIVE_TYPES = new Set(['textDirective', 'leafDirective', 'containerDirective'])

interface MdastNode {
	type: string
	name?: unknown
	value?: unknown
	attributes?: Record<string, unknown> | null
	children?: MdastNode[]
	data?: { hName?: string; hProperties?: Record<string, unknown> }
}

function normalizeListStyleClass(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const [className] = value.trim().split(/\s+/)
	if (!className || !LIST_STYLE_CLASS_RE.test(className)) return null
	return className
}

function childrenOf(node: MdastNode): MdastNode[] {
	return Array.isArray(node.children) ? node.children : []
}

function directiveMarker(type: string): string {
	if (type === 'containerDirective') return ':::'
	if (type === 'leafDirective') return '::'
	return ':'
}

function stringifyAttributes(attributes: Record<string, unknown> | null | undefined): string {
	if (!attributes) return ''
	const parts: string[] = []
	for (const [key, value] of Object.entries(attributes)) {
		if (key === 'class' && typeof value === 'string') {
			for (const cls of value.split(/\s+/).filter(Boolean)) parts.push(`.${cls}`)
		} else if (key === 'id' && typeof value === 'string') {
			parts.push(`#${value}`)
		} else {
			parts.push(`${key}="${String(value)}"`)
		}
	}
	return parts.length > 0 ? `{${parts.join(' ')}}` : ''
}

function text(value: string): MdastNode {
	return { type: 'text', value }
}

// Turn a `:::list{.className}` directive into its inner list, tagged with the
// class so remark-rehype emits `<ul class="className">`. Always unwraps (keeps
// the list content) even when the class is missing/invalid.
function unwrapListDirective(node: MdastNode): MdastNode[] {
	const children = childrenOf(node)
	const className = normalizeListStyleClass(node.attributes?.class)
	if (className) {
		const list = children.find(child => child.type === 'list')
		if (list) {
			const data = list.data ?? (list.data = {})
			const properties = data.hProperties ?? (data.hProperties = {})
			properties.className = [className]
		}
	}
	return children
}

// Pull the video id out of a youtube directive's attributes: the emitted `{#id}`
// form (→ `id`), the legacy bare `{id}` form (→ a single empty-valued key) and
// `{id=…}`. Returns null for anything that isn't a plausible video id.
function youtubeVideoId(attributes: Record<string, unknown> | null | undefined): string | null {
	if (!attributes) return null
	const id = attributes.id
	if (typeof id === 'string' && VIDEO_ID_RE.test(id)) return id
	for (const [key, value] of Object.entries(attributes)) {
		if ((value === '' || value == null) && VIDEO_ID_RE.test(key)) return key
	}
	return null
}

// Turn `::youtube{#id}` into an `<iframe class="youtube-embed">`. The framework emits
// a working, privacy-friendly embed; the site owns the styling (e.g. responsive 16:9
// via `.youtube-embed`), exactly like the styled-list `<ul class>`. Returns false when
// no id is present so the caller can fall back to neutralizing the directive to text.
function renderYoutubeDirective(node: MdastNode): boolean {
	const id = youtubeVideoId(node.attributes)
	if (!id) return false
	const data = node.data ?? (node.data = {})
	data.hName = 'iframe'
	data.hProperties = {
		src: `https://www.youtube-nocookie.com/embed/${id}`,
		title: 'YouTube video',
		width: '560',
		height: '315',
		loading: 'lazy',
		allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
		allowFullScreen: true,
		className: ['youtube-embed'],
	}
	node.children = []
	return true
}

// Reconstruct any non-list directive back to literal source so no text is lost.
function neutralizeDirective(node: MdastNode): MdastNode[] {
	const marker = directiveMarker(node.type)
	const name = typeof node.name === 'string' ? node.name : ''
	const label = childrenOf(node)
	const attributes = stringifyAttributes(node.attributes)

	if (node.type === 'textDirective') {
		const parts: MdastNode[] = [text(`${marker}${name}`)]
		if (label.length > 0) parts.push(text('['), ...label, text(']'))
		if (attributes) parts.push(text(attributes))
		return parts
	}

	// Block-level (leaf/container) false positives are extremely unlikely in
	// prose; preserve the content and prefix it with the literal opening line.
	const opener: MdastNode = { type: 'paragraph', children: [text(`${marker}${name}${attributes}`)] }
	return [opener, ...label]
}

function transform(node: MdastNode): void {
	const children = node.children
	if (!Array.isArray(children)) return

	for (let index = 0; index < children.length; index++) {
		const child = children[index]
		if (!child) continue
		transform(child)

		if (!DIRECTIVE_TYPES.has(child.type)) continue

		// YouTube renders in place as an <iframe>; keep the node (now carrying hName).
		if (child.name === YOUTUBE_DIRECTIVE_NAME && renderYoutubeDirective(child)) continue

		const replacement = child.type === 'containerDirective' && child.name === LIST_DIRECTIVE_NAME
			? unwrapListDirective(child)
			: neutralizeDirective(child)

		children.splice(index, 1, ...replacement)
		index += replacement.length - 1
	}
}

export const remarkListDirective: Plugin<[]> = () => (tree) => {
	transform(tree)
}
