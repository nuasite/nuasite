import type { Plugin } from 'unified'

// Render-side counterpart of the editor's styled-list plugin
// (packages/cms-mdx-editor/src/styled-list-plugin.ts). The editor serializes a
// styled list as the container directive `:::list{.className}`. On the site we
// need `remark-directive` to claim that syntax before MDX would otherwise treat
// `{.className}` as a JSX expression and crash acorn. This plugin then turns the
// `list` directive into a plain `<ul class="className">` and — crucially —
// converts every OTHER directive node back to its literal source text, so a
// stray colon in prose (e.g. `klíč:hodnota` → a `:hodnota` text directive) is
// never silently dropped by remark-rehype.

const LIST_DIRECTIVE_NAME = 'list'
const LIST_STYLE_CLASS_RE = /^[A-Za-z0-9_-]+$/
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
