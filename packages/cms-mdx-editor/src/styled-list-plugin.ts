import { bulletListAttr, bulletListSchema, orderedListAttr, orderedListSchema } from '@milkdown/preset-commonmark'
import type { Attrs, Node as PmNode } from '@milkdown/prose/model'
import type { Command } from '@milkdown/prose/state'
import type { JSONRecord, MarkdownNode, Root, SerializerState } from '@milkdown/transformer'
import { $command, $remark } from '@milkdown/utils'
import type { Plugin } from 'unified'

const LIST_DIRECTIVE_NAME = 'list'
const LIST_STYLE_CLASS_RE = /^[A-Za-z0-9_-]+$/

interface ListDirectiveNode extends MutableMarkdownNode {
	type: 'containerDirective'
	name?: unknown
	attributes?: unknown
}

interface DirectiveAttributes {
	class?: unknown
}

interface MutableMarkdownNode {
	type: string
	value?: unknown
	children?: MutableMarkdownNode[]
	ordered?: unknown
	start?: unknown
	spread?: unknown
	listStyle?: unknown
	attributes?: unknown
}

interface MarkdownStringifyState {
	containerFlow: (node: MutableMarkdownNode, info: unknown) => string
}

export function normalizeListStyleClass(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const [className] = value.trim().split(/\s+/)
	if (!className || !LIST_STYLE_CLASS_RE.test(className)) return null
	return className
}

function childrenOf(node: MutableMarkdownNode | undefined): MutableMarkdownNode[] | null {
	return Array.isArray(node?.children) ? node.children : null
}

function lastChildOf(node: MutableMarkdownNode | undefined): MutableMarkdownNode | undefined {
	const children = childrenOf(node)
	return children && children.length > 0 ? children[children.length - 1] : undefined
}

function getAttributes(node: { attributes?: unknown }): DirectiveAttributes | null {
	if (!node.attributes || typeof node.attributes !== 'object' || Array.isArray(node.attributes)) return null
	return node.attributes
}

function getDirectiveClass(node: ListDirectiveNode): string | null {
	return normalizeListStyleClass(getAttributes(node)?.class)
}

function isParagraphText(node: MutableMarkdownNode | undefined, value?: string): boolean {
	const children = childrenOf(node)
	if (node?.type !== 'paragraph' || children?.length !== 1) return false
	const text = children[0]
	if (text?.type !== 'text' || typeof text.value !== 'string') return false
	return value === undefined ? true : text.value === value
}

function parseOpeningDirective(node: MutableMarkdownNode | undefined): string | null {
	if (!isParagraphText(node)) return null
	const text = childrenOf(node)?.[0]
	if (typeof text?.value !== 'string') return null
	const match = /^:::list\{\.([A-Za-z0-9_-]+)\}$/.exec(text.value)
	return match?.[1] ?? null
}

function isListNode(node: MutableMarkdownNode | undefined): node is MutableMarkdownNode {
	return node?.type === 'list'
}

function stripRawClosingDirective(listNode: MutableMarkdownNode, siblings: MutableMarkdownNode[], indexAfterList: number): boolean {
	if (isParagraphText(siblings[indexAfterList], ':::')) {
		siblings.splice(indexAfterList, 1)
		return true
	}

	const lastItem = lastChildOf(listNode)
	const lastBlock = lastChildOf(lastItem)
	if (!lastBlock || lastBlock.type !== 'paragraph') return false
	const lastBlockChildren = childrenOf(lastBlock)
	const lastText = lastChildOf(lastBlock)
	if (!lastBlockChildren || lastText?.type !== 'text' || typeof lastText.value !== 'string') return false

	if (lastText.value === ':::') {
		lastBlockChildren.pop()
	} else if (lastText.value.endsWith('\n:::')) {
		lastText.value = lastText.value.slice(0, -4)
	} else {
		return false
	}

	if (lastBlockChildren.length === 0) {
		const lastItemChildren = childrenOf(lastItem)
		lastItemChildren?.pop()
	}
	return true
}

export function transformListDirectives(parent: MutableMarkdownNode): void {
	const children = childrenOf(parent)
	if (!children) return

	for (let index = 0; index < children.length; index++) {
		const child = children[index]
		if (!child) continue

		if (child.type === 'containerDirective') {
			const directive = child as ListDirectiveNode
			const className = directive.name === LIST_DIRECTIVE_NAME ? getDirectiveClass(directive) : null
			const directiveChildren = childrenOf(directive)
			const list = directiveChildren?.length === 1 ? directiveChildren[0] : undefined
			if (className && isListNode(list)) {
				children[index] = {
					...list,
					listStyle: className,
				}
				continue
			}
		}

		const rawClassName = parseOpeningDirective(child)
		const rawList = children[index + 1]
		if (rawClassName && isListNode(rawList) && stripRawClosingDirective(rawList, children, index + 2)) {
			children.splice(index, 1)
			children[index] = {
				...rawList,
				listStyle: rawClassName,
			}
			continue
		}

		transformListDirectives(child)
	}
}

function hasContainerFlow(value: unknown): value is MarkdownStringifyState {
	return Boolean(value && typeof value === 'object' && 'containerFlow' in value && typeof value.containerFlow === 'function')
}

const listDirectiveHandler = (node: MutableMarkdownNode, _parent: unknown, state: unknown, info: unknown): string => {
	if (!hasContainerFlow(state)) return ''
	const className = normalizeListStyleClass(getAttributes(node)?.class)
	const children = state.containerFlow(node, info)
	return `:::list${className ? `{.${className}}` : ''}\n${children}\n:::`
}

const remarkListDirective: Plugin<[], Root> = function() {
	const extensions = this.data('toMarkdownExtensions') ?? []
	const listDirectiveExtension = {
		handlers: {
			containerDirective: listDirectiveHandler,
		},
	} as unknown as (typeof extensions)[number]
	extensions.push(listDirectiveExtension)
	this.data('toMarkdownExtensions', extensions)

	return (tree) => {
		transformListDirectives(tree)
	}
}

export const remarkListDirectivePlugin = $remark('remarkListDirective', () => remarkListDirective)

function getPreviousAttrs(value: Attrs | false | null | undefined): Attrs {
	return value && typeof value === 'object' ? value : {}
}

function listStyleProps(listStyle: string | null): JSONRecord | undefined {
	if (!listStyle) return undefined
	return {
		name: LIST_DIRECTIVE_NAME,
		attributes: { class: listStyle },
	}
}

function serializeListWithOptionalStyle(
	state: SerializerState,
	node: PmNode,
	props: JSONRecord,
): void {
	const listStyle = normalizeListStyleClass(node.attrs.listStyle)
	const directiveProps = listStyleProps(listStyle)
	if (directiveProps) state.openNode('containerDirective', undefined, directiveProps)

	state.openNode('list', undefined, props).next(node.content).closeNode()

	if (directiveProps) state.closeNode()
}

export const styledBulletListSchema = bulletListSchema.extendSchema((prev) => (ctx) => {
	const schema = prev(ctx)
	return {
		...schema,
		attrs: {
			...schema.attrs,
			listStyle: {
				default: null,
				validate: 'string|null',
			},
		},
		parseDOM: [
			{
				tag: 'ul',
				getAttrs: (dom) => {
					const previousAttrs = getPreviousAttrs(schema.parseDOM?.[0]?.getAttrs?.(dom))
					const className = dom instanceof HTMLElement ? normalizeListStyleClass(dom.className) : null
					return {
						...previousAttrs,
						listStyle: className,
					}
				},
			},
		],
		toDOM: (node: PmNode) => {
			const className = normalizeListStyleClass(node.attrs.listStyle)
			return [
				'ul',
				{
					...ctx.get(bulletListAttr.key)(node),
					...(className ? { class: className } : {}),
					'data-spread': node.attrs.spread,
				},
				0,
			]
		},
		parseMarkdown: {
			match: ({ type, ordered }: MarkdownNode & { ordered?: unknown }) => type === 'list' && !ordered,
			runner: (state, node: MarkdownNode & { spread?: unknown; listStyle?: unknown }, type) => {
				state.openNode(type, {
					spread: node.spread === true,
					listStyle: normalizeListStyleClass(node.listStyle),
				}).next(node.children).closeNode()
			},
		},
		toMarkdown: {
			match: (node: PmNode) => node.type.name === 'bullet_list',
			runner: (state: SerializerState, node: PmNode) => {
				serializeListWithOptionalStyle(state, node, {
					ordered: false,
					spread: node.attrs.spread === true,
				})
			},
		},
	}
})

export const styledOrderedListSchema = orderedListSchema.extendSchema((prev) => (ctx) => {
	const schema = prev(ctx)
	return {
		...schema,
		attrs: {
			...schema.attrs,
			listStyle: {
				default: null,
				validate: 'string|null',
			},
		},
		parseDOM: [
			{
				tag: 'ol',
				getAttrs: (dom) => {
					const previousAttrs = getPreviousAttrs(schema.parseDOM?.[0]?.getAttrs?.(dom))
					const className = dom instanceof HTMLElement ? normalizeListStyleClass(dom.className) : null
					return {
						...previousAttrs,
						listStyle: className,
					}
				},
			},
		],
		toDOM: (node: PmNode) => {
			const className = normalizeListStyleClass(node.attrs.listStyle)
			return [
				'ol',
				{
					...ctx.get(orderedListAttr.key)(node),
					...(node.attrs.order === 1 ? {} : { start: node.attrs.order }),
					...(className ? { class: className } : {}),
					'data-spread': node.attrs.spread,
				},
				0,
			]
		},
		parseMarkdown: {
			match: ({ type, ordered }: MarkdownNode & { ordered?: unknown }) => type === 'list' && !!ordered,
			runner: (state, node: MarkdownNode & { spread?: unknown; start?: unknown; listStyle?: unknown }, type) => {
				state.openNode(type, {
					order: typeof node.start === 'number' ? node.start : 1,
					spread: node.spread === true,
					listStyle: normalizeListStyleClass(node.listStyle),
				}).next(node.children).closeNode()
			},
		},
		toMarkdown: {
			match: (node: PmNode) => node.type.name === 'ordered_list',
			runner: (state: SerializerState, node: PmNode) => {
				serializeListWithOptionalStyle(state, node, {
					ordered: true,
					start: typeof node.attrs.order === 'number' ? node.attrs.order : 1,
					spread: node.attrs.spread === true,
				})
			},
		},
	}
})

export const setListStyleCommand = $command('SetListStyle', () => {
	return (listStyle?: string | null): Command => {
		return (state, dispatch) => {
			const listTypes = new Set([state.schema.nodes.bullet_list, state.schema.nodes.ordered_list].filter(Boolean))
			if (listTypes.size === 0) return false

			const nextStyle = normalizeListStyleClass(listStyle)
			const positions = new Map<number, PmNode>()
			const { from, to, $from } = state.selection

			for (let depth = $from.depth; depth > 0; depth--) {
				const node = $from.node(depth)
				if (listTypes.has(node.type)) {
					positions.set($from.before(depth), node)
					break
				}
			}

			state.doc.nodesBetween(from, to, (node, pos) => {
				if (listTypes.has(node.type)) positions.set(pos, node)
			})

			if (positions.size === 0) return false

			if (dispatch) {
				let tr = state.tr
				for (const [pos, node] of positions) {
					tr = tr.setNodeMarkup(pos, undefined, {
						...node.attrs,
						listStyle: nextStyle,
					})
				}
				dispatch(tr.scrollIntoView())
			}
			return true
		}
	}
})

export const styledListPlugin = [
	remarkListDirectivePlugin,
	styledBulletListSchema,
	styledOrderedListSchema,
	setListStyleCommand,
].flat()
