/**
 * Milkdown plugin that round-trips MDX component blocks through the editor.
 *
 * Ported from `@nuasite/cms`'s in-iframe `milkdown-mdx-plugin.tsx` — the parse/
 * serialize logic operates on the remark-mdx (mdast) AST and is framework-agnostic,
 * so it moves here verbatim. The only piece that was preact-coupled — the node
 * `$view` that renders the block-card — lives separately in `mdx-view.tsx` (React)
 * and is composed into the plugin array by `MdxBodyEditor`.
 *
 * The mdast nodes are intentionally typed loosely (`any`): they are the dynamic
 * remark-mdx AST, the same boundary the original treated as untyped.
 */
import type { Node as PmNode, NodeType } from '@milkdown/prose/model'
import type { Command } from '@milkdown/prose/state'
import type { MarkdownNode, SerializerState } from '@milkdown/transformer'
import { $command, $node, $remark } from '@milkdown/utils'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/** Prefix marking expression attributes (`prop={value}`) vs string literals in serialized props. */
export const MDX_EXPR_PREFIX = '__mdx_expr__:'

/** HTML void elements that should not be treated as editable MDX components. */
const HTML_VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'])

/** Cached unified processor for parsing markdown children during serialization. */
const remarkParser = unified().use(remarkParse)

export const remarkMdxPlugin: any = $remark('remarkMdx', () => remarkMdx)

function parseJsxAttributes(attributes: any[]): { props: Record<string, string>; hasExpressions: boolean } {
	const props: Record<string, string> = {}
	let hasExpressions = false

	if (!Array.isArray(attributes)) return { props, hasExpressions }

	for (const attr of attributes) {
		if (attr.type === 'mdxJsxAttribute' && attr.name) {
			if (attr.value === null || attr.value === undefined) {
				// Boolean attribute: <Component flag />
				props[attr.name] = 'true'
			} else if (typeof attr.value === 'string') {
				props[attr.name] = attr.value
			} else if (attr.value?.type === 'mdxJsxAttributeValueExpression') {
				// Expression attribute: prop={value}
				props[attr.name] = `${MDX_EXPR_PREFIX}${attr.value.value}`
				hasExpressions = true
			}
		}
		if (attr.type === 'mdxJsxExpressionAttribute') {
			hasExpressions = true
		}
	}

	return { props, hasExpressions }
}

function serializePropsToAttributes(props: Record<string, string>): any[] {
	const attributes: any[] = []

	for (const [name, value] of Object.entries(props)) {
		if (value.startsWith(MDX_EXPR_PREFIX)) {
			attributes.push({
				type: 'mdxJsxAttribute',
				name,
				value: {
					type: 'mdxJsxAttributeValueExpression',
					value: value.slice(MDX_EXPR_PREFIX.length),
				},
			})
		} else {
			attributes.push({
				type: 'mdxJsxAttribute',
				name,
				value,
			})
		}
	}

	return attributes
}

/** Serialize mdast children back to markdown text. */
function serializeChildren(children: any[]): string {
	if (!children || children.length === 0) return ''
	const parts: string[] = []
	for (const child of children) {
		if (child.type === 'paragraph') {
			const text = serializeInlineChildren(child.children ?? [])
			parts.push(text)
		} else if (child.type === 'text') {
			parts.push(child.value ?? '')
		} else if (child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement') {
			// Nested JSX — reconstruct as string
			const name = child.name ?? ''
			const attrs = (child.attributes ?? [])
				.map((a: any) => {
					if (a.type === 'mdxJsxAttribute' && a.name) {
						if (typeof a.value === 'string') return `${a.name}="${a.value}"`
						if (a.value?.type === 'mdxJsxAttributeValueExpression') return `${a.name}={${a.value.value}}`
					}
					return ''
				})
				.filter(Boolean)
				.join(' ')
			const inner = serializeChildren(child.children ?? [])
			if (inner) {
				parts.push(`<${name}${attrs ? ' ' + attrs : ''}>${inner}</${name}>`)
			} else {
				parts.push(`<${name}${attrs ? ' ' + attrs : ''} />`)
			}
		} else {
			// Fallback — use value if present
			if (child.value) parts.push(child.value)
		}
	}
	return parts.join('\n\n')
}

function serializeInlineChildren(children: any[]): string {
	return children.map((c: any) => {
		if (c.type === 'text') return c.value ?? ''
		if (c.type === 'strong') return `**${serializeInlineChildren(c.children ?? [])}**`
		if (c.type === 'emphasis') return `*${serializeInlineChildren(c.children ?? [])}*`
		if (c.type === 'inlineCode') return `\`${c.value ?? ''}\``
		if (c.type === 'link') return `[${serializeInlineChildren(c.children ?? [])}](${c.url ?? ''})`
		return c.value ?? ''
	}).join('')
}

export const mdxComponentNode = $node('mdx_component', () => ({
	group: 'block',
	atom: true,
	isolating: true,
	selectable: true,
	draggable: false,
	attrs: {
		componentName: { default: '' },
		props: { default: '{}' },
		hasExpressions: { default: false },
		children: { default: '' },
	},
	toDOM: (node: PmNode) => {
		const div = document.createElement('div')
		div.setAttribute('data-mdx-component', node.attrs.componentName)
		div.setAttribute('data-mdx-props', node.attrs.props)
		if (node.attrs.children) div.setAttribute('data-mdx-children', node.attrs.children)
		if (node.attrs.hasExpressions) div.setAttribute('data-mdx-expressions', 'true')
		div.className = 'mdx-component-block'
		div.textContent = `<${node.attrs.componentName} />`
		return div as any
	},
	parseDOM: [{
		tag: 'div[data-mdx-component]',
		getAttrs: (dom: HTMLElement) => ({
			componentName: dom.getAttribute('data-mdx-component') || '',
			props: dom.getAttribute('data-mdx-props') || '{}',
			children: dom.getAttribute('data-mdx-children') || '',
			hasExpressions: dom.getAttribute('data-mdx-expressions') === 'true',
		}),
	}],
	parseMarkdown: {
		match: (node: MarkdownNode) => node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement',
		runner: (state, node, proseType: NodeType) => {
			const name = (node as any).name as string | null
			if (!name) return // Skip fragments
			// Skip HTML void elements — they are not editable components
			if (HTML_VOID_ELEMENTS.has(name.toLowerCase())) return

			const { props, hasExpressions } = parseJsxAttributes((node as any).attributes)
			const children = serializeChildren((node as any).children ?? [])

			state.addNode(proseType, {
				componentName: name,
				props: JSON.stringify(props),
				hasExpressions,
				children,
			})
		},
	},
	toMarkdown: {
		match: (node: PmNode) => node.type.name === 'mdx_component',
		runner: (state: SerializerState, node: PmNode) => {
			const componentName = node.attrs.componentName as string
			const props: Record<string, string> = JSON.parse(node.attrs.props as string)
			const childrenText = (node.attrs.children as string) || ''
			const attributes = serializePropsToAttributes(props)

			if (childrenText.trim()) {
				// Parse children markdown into proper mdast nodes so headings, lists, etc. are preserved
				const childrenAst = remarkParser.parse(childrenText)
				state.addNode('mdxJsxFlowElement', undefined, undefined, {
					name: componentName,
					attributes,
					children: childrenAst.children,
				} as any)
			} else {
				state.addNode('mdxJsxFlowElement', undefined, undefined, {
					name: componentName,
					attributes,
					children: [],
				} as any)
			}
		},
	},
}))

export interface InsertMdxComponentPayload {
	componentName: string
	props: Record<string, string>
	children?: string
}

export const insertMdxComponentCommand = $command('insertMdxComponent', () => {
	return (payload?: InsertMdxComponentPayload): Command => {
		return (state, dispatch) => {
			if (!payload) return false
			const nodeType = state.schema.nodes.mdx_component
			if (!nodeType) return false

			const node = nodeType.create({
				componentName: payload.componentName,
				props: JSON.stringify(payload.props),
				hasExpressions: false,
				children: payload.children || '',
			})

			if (dispatch) {
				const { from } = state.selection
				const tr = state.tr.insert(from, node)
				dispatch(tr)
			}
			return true
		}
	}
})

/**
 * Hidden node that preserves `import ... from '...'` statements through the round-trip.
 * remark-mdx parses these as `mdxjsEsm` — without a matching ProseMirror node Milkdown throws.
 */
export const mdxEsmNode = $node('mdx_esm', () => ({
	group: 'block',
	atom: true,
	attrs: {
		value: { default: '' },
	},
	toDOM: () => {
		// Render nothing — imports are invisible in the editor
		const span = document.createElement('span')
		span.style.display = 'none'
		return span as any
	},
	parseDOM: [],
	parseMarkdown: {
		match: (node: MarkdownNode) => node.type === 'mdxjsEsm',
		runner: (state, node, proseType: NodeType) => {
			state.addNode(proseType, { value: (node as any).value ?? '' })
		},
	},
	toMarkdown: {
		match: (node: PmNode) => node.type.name === 'mdx_esm',
		runner: (state: SerializerState, node: PmNode) => {
			state.addNode('mdxjsEsm', undefined, undefined, {
				value: node.attrs.value as string,
			} as any)
		},
	},
}))
