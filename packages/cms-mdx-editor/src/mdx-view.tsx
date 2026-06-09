/**
 * React node-view for the `mdx_component` node. Replaces the original preact
 * `render()` view: renders `MdxBlockCard` into the node-view container via a
 * per-node React root, and writes edits back as ProseMirror node attrs.
 *
 * `getComponent` resolves a component's definition (props/slots) for labels and
 * default-slot detection — supplied by the editor from the `components` prop.
 */
import type { Node as PmNode } from '@milkdown/prose/model'
import { $view } from '@milkdown/utils'
import type { ComponentDefinition } from '@nuasite/cms-types'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MdxBlockCard } from './mdx-block-card'
import type { MediaContext, MediaSource } from './media-source'
import { mdxComponentNode } from './mdx-plugin'

export type ComponentResolver = (name: string) => ComponentDefinition | undefined

export function createMdxComponentView(getComponent: ComponentResolver, media?: MediaSource, mediaContext?: MediaContext) {
	return $view(mdxComponentNode, () => {
		return (pmNode, view, getPos) => {
			const container = document.createElement('div')
			container.className = 'mdx-block-card-wrapper'
			container.setAttribute('data-cms-ui', '')
			container.contentEditable = 'false'
			const root: Root = createRoot(container)

			let lastAttrs: { componentName: string; props: string; hasExpressions: boolean; children: string } | null = null

			const updateNodeAttrs = (update: Record<string, unknown>) => {
				const pos = typeof getPos === 'function' ? getPos() : null
				if (pos == null) return
				const currentNode = view.state.doc.nodeAt(pos)
				if (!currentNode) return
				const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, ...update })
				view.dispatch(tr)
			}

			const removeNode = () => {
				const pos = typeof getPos === 'function' ? getPos() : null
				if (pos == null) return
				const currentNode = view.state.doc.nodeAt(pos)
				if (!currentNode) return
				view.dispatch(view.state.tr.delete(pos, pos + currentNode.nodeSize))
			}

			const renderCard = (node: PmNode) => {
				const componentName = node.attrs.componentName as string
				const propsJson = node.attrs.props as string
				const hasExpressions = node.attrs.hasExpressions as boolean
				const children = (node.attrs.children as string) || ''

				container.setAttribute('data-mdx-component', componentName)
				container.setAttribute('data-mdx-props', propsJson)
				container.setAttribute('data-mdx-children', children)

				const props: Record<string, string> = JSON.parse(propsJson)
				const definition = getComponent(componentName)
				const hasDefaultSlot = (definition?.slots?.includes('default') ?? false) || children.trim() !== ''

				lastAttrs = { componentName, props: propsJson, hasExpressions, children }

				root.render(createElement(MdxBlockCard, {
					componentName,
					props,
					hasExpressions,
					slotContent: children,
					definition,
					media,
					mediaContext,
					onRemove: removeNode,
					onSlotContentChange: hasDefaultSlot ? (newContent: string) => updateNodeAttrs({ children: newContent }) : undefined,
					onPropsChange: hasExpressions ? undefined : (newProps: Record<string, string>) => updateNodeAttrs({ props: JSON.stringify(newProps) }),
				}))
			}

			renderCard(pmNode)

			return {
				dom: container,
				stopEvent: (event: Event) => {
					const target = event.target as HTMLElement
					if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return true
					if (target.isContentEditable || target.closest('[contenteditable]')) return true
					if (target.closest('[data-mdx-action]')) return true
					if (event.type === 'mousedown' || event.type === 'click') {
						if (target.closest('button') || target.closest('[data-mdx-action]')) return true
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
						&& attrs.children === lastAttrs.children
					) {
						return true
					}
					renderCard(updatedNode)
					return true
				},
				destroy: () => {
					// Defer unmount out of the ProseMirror dispatch tick (React forbids
					// unmounting a root while it may still be rendering).
					queueMicrotask(() => root.unmount())
				},
			}
		}
	})
}
