import type { Node as PmNode, NodeType } from '@milkdown/prose/model'
import type { Command } from '@milkdown/prose/state'
import type { MarkdownNode, SerializerState } from '@milkdown/transformer'
import { $command, $node, $remark, $view } from '@milkdown/utils'
import { render } from 'preact'
import remarkMdx from 'remark-mdx'
import { MdxBlockCard } from './components/mdx-block-view'
import { openMdxPropsEditor } from './signals'

/** Prefix used to distinguish expression attributes from string literals in serialized props */
export const MDX_EXPR_PREFIX = '__mdx_expr__:'

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

export const mdxComponentNode = $node('mdx_component', () => ({
	group: 'block',
	atom: true,
	isolating: true,
	selectable: true,
	draggable: true,
	attrs: {
		componentName: { default: '' },
		props: { default: '{}' },
		hasExpressions: { default: false },
	},
	toDOM: (node: PmNode) => {
		const div = document.createElement('div')
		div.setAttribute('data-mdx-component', node.attrs.componentName)
		div.setAttribute('data-mdx-props', node.attrs.props)
		div.className = 'mdx-component-block'
		div.textContent = `<${node.attrs.componentName} />`
		return div as any
	},
	parseDOM: [{
		tag: 'div[data-mdx-component]',
		getAttrs: (dom: HTMLElement) => ({
			componentName: dom.getAttribute('data-mdx-component') || '',
			props: dom.getAttribute('data-mdx-props') || '{}',
		}),
	}],
	parseMarkdown: {
		match: (node: MarkdownNode) => node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement',
		runner: (state, node, proseType: NodeType) => {
			const name = (node as any).name as string | null
			if (!name) return // Skip fragments

			const { props, hasExpressions } = parseJsxAttributes((node as any).attributes)

			state.addNode(proseType, {
				componentName: name,
				props: JSON.stringify(props),
				hasExpressions,
			})
		},
	},
	toMarkdown: {
		match: (node: PmNode) => node.type.name === 'mdx_component',
		runner: (state: SerializerState, node: PmNode) => {
			const componentName = node.attrs.componentName as string
			const props: Record<string, string> = JSON.parse(node.attrs.props as string)
			const attributes = serializePropsToAttributes(props)

			state.addNode('mdxJsxFlowElement', undefined, undefined, {
				name: componentName,
				attributes,
				children: [],
			} as any)
		},
	},
}))

export interface InsertMdxComponentPayload {
	componentName: string
	props: Record<string, string>
}

export const insertMdxComponentCommand = $command('insertMdxComponent', (ctx) => {
	return (payload?: InsertMdxComponentPayload): Command => {
		return (state, dispatch) => {
			if (!payload) return false
			const nodeType = state.schema.nodes.mdx_component
			if (!nodeType) return false

			const node = nodeType.create({
				componentName: payload.componentName,
				props: JSON.stringify(payload.props),
				hasExpressions: false,
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

export const mdxComponentView = $view(mdxComponentNode, () => {
	return (pmNode, view, getPos) => {
		const container = document.createElement('div')
		container.className = 'mdx-block-card-wrapper'
		container.setAttribute('data-cms-ui', '')
		container.contentEditable = 'false'

		let lastAttrs: { componentName: string; props: string; hasExpressions: boolean } | null = null

		const renderCard = (node: PmNode) => {
			const componentName = node.attrs.componentName as string
			const propsJson = node.attrs.props as string
			const props: Record<string, string> = JSON.parse(propsJson)
			const hasExpressions = node.attrs.hasExpressions as boolean

			lastAttrs = { componentName, props: propsJson, hasExpressions }

			render(
				<MdxBlockCard
					componentName={componentName}
					props={props}
					hasExpressions={hasExpressions}
					onEdit={(cursorPos) => {
						const pos = typeof getPos === 'function' ? getPos() : null
						if (pos != null) {
							openMdxPropsEditor(pos, componentName, props, cursorPos)
						}
					}}
					onRemove={() => {
						const pos = typeof getPos === 'function' ? getPos() : null
						if (pos != null) {
							const currentNode = view.state.doc.nodeAt(pos)
							if (currentNode) {
								const tr = view.state.tr.delete(pos, pos + currentNode.nodeSize)
								view.dispatch(tr)
							}
						}
					}}
				/>,
				container,
			)
		}

		renderCard(pmNode)

		return {
			dom: container,
			stopEvent: (event: Event) => {
				if (event.type === 'mousedown' || event.type === 'click') {
					const target = event.target as HTMLElement
					if (target.closest('button') || target.closest('[data-mdx-action]')) {
						return true
					}
				}
				return false
			},
			ignoreMutation: () => true,
			update: (updatedNode: PmNode) => {
				if (updatedNode.type.name !== 'mdx_component') return false
				const attrs = updatedNode.attrs
				if (
					lastAttrs
					&& attrs.componentName === lastAttrs.componentName
					&& attrs.props === lastAttrs.props
					&& attrs.hasExpressions === lastAttrs.hasExpressions
				) {
					return true
				}
				renderCard(updatedNode)
				return true
			},
			destroy: () => {
				render(null, container)
			},
		}
	}
})

/**
 * Hidden node that preserves `import ... from '...'` statements through the editor round-trip.
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

export const mdxComponentPlugin = [
	remarkMdxPlugin,
	mdxEsmNode,
	mdxComponentNode,
	mdxComponentView,
	insertMdxComponentCommand,
] as const
