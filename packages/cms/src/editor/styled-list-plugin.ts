import { remarkStringifyOptionsCtx } from '@milkdown/core'
import { bulletListAttr, bulletListSchema } from '@milkdown/preset-commonmark'
import type { Node as PmNode } from '@milkdown/prose/model'
import type { Command } from '@milkdown/prose/state'
import type { MarkdownNode, SerializerState } from '@milkdown/transformer'
import { $command, $remark } from '@milkdown/utils'

const LIST_DIRECTIVE_NAME = 'list'

function normalizeListStyleClass(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const [className] = value.trim().split(/\s+/)
	return className || null
}

function getDirectiveClass(node: any): string | null {
	const className = node.attributes?.class
	return normalizeListStyleClass(className)
}

function isParagraphText(node: any, value?: string): boolean {
	if (node?.type !== 'paragraph' || node.children?.length !== 1) return false
	const text = node.children[0]
	if (text?.type !== 'text') return false
	return value === undefined ? true : text.value === value
}

function parseOpeningDirective(node: any): string | null {
	if (!isParagraphText(node)) return null
	const value = node.children[0].value
	const match = /^:::list\{\.([^}\s]+)\}$/.exec(value)
	return match?.[1] ?? null
}

function stripRawClosingDirective(listNode: any, siblings: any[], indexAfterList: number): boolean {
	if (isParagraphText(siblings[indexAfterList], ':::')) {
		siblings.splice(indexAfterList, 1)
		return true
	}

	const lastItem = listNode.children?.at(-1)
	const lastBlock = lastItem?.children?.at(-1)
	if (!lastBlock || lastBlock.type !== 'paragraph') return false
	const lastText = lastBlock.children?.at(-1)
	if (lastText?.type !== 'text' || typeof lastText.value !== 'string') return false

	if (lastText.value === ':::') {
		lastBlock.children.pop()
	} else if (lastText.value.endsWith('\n:::')) {
		lastText.value = lastText.value.slice(0, -4)
	} else {
		return false
	}

	if (lastBlock.children.length === 0) lastItem.children.pop()
	return true
}

function transformListDirectives(parent: any): void {
	if (!Array.isArray(parent?.children)) return

	for (let index = 0; index < parent.children.length; index++) {
		const child = parent.children[index]

		if (child?.type === 'containerDirective' && child.name === LIST_DIRECTIVE_NAME) {
			const className = getDirectiveClass(child)
			const list = child.children?.length === 1 ? child.children[0] : null
			if (className && list?.type === 'list' && !list.ordered) {
				parent.children[index] = {
					...list,
					listStyle: className,
				}
				continue
			}
		}

		const rawClassName = parseOpeningDirective(child)
		const rawList = parent.children[index + 1]
		if (rawClassName && rawList?.type === 'list' && !rawList.ordered && stripRawClosingDirective(rawList, parent.children, index + 2)) {
			parent.children.splice(index, 1)
			parent.children[index] = {
				...rawList,
				listStyle: rawClassName,
			}
			continue
		}

		transformListDirectives(child)
	}
}

function listDirectiveHandler(node: any, _parent: any, state: any, info: any): string {
	const className = normalizeListStyleClass(node.attributes?.class)
	const children = state.containerFlow(node, info)
	return `:::list${className ? `{.${className}}` : ''}\n${children}\n:::`
}

function remarkListDirective(this: { data: () => any }) {
	const data = this.data()
	const toMarkdownExtensions = data.toMarkdownExtensions || (data.toMarkdownExtensions = [])
	toMarkdownExtensions.push({
		handlers: {
			containerDirective: listDirectiveHandler,
		},
	})

	return (tree: any) => {
		transformListDirectives(tree)
	}
}

export const remarkListDirectivePlugin: any = $remark('remarkListDirective', () => remarkListDirective as any)

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
					const previousAttrs = schema.parseDOM?.[0]?.getAttrs?.(dom) ?? {}
					const className = dom instanceof HTMLElement ? normalizeListStyleClass(dom.className) : null
					return {
						...(typeof previousAttrs === 'object' ? previousAttrs : {}),
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
			match: ({ type, ordered }: MarkdownNode & { ordered?: boolean }) => type === 'list' && !ordered,
			runner: (state, node: MarkdownNode & { spread?: boolean; listStyle?: string }, type) => {
				state.openNode(type, {
					spread: node.spread ?? false,
					listStyle: normalizeListStyleClass(node.listStyle),
				}).next(node.children).closeNode()
			},
		},
		toMarkdown: {
			match: (node: PmNode) => node.type.name === 'bullet_list',
			runner: (state: SerializerState, node: PmNode) => {
				const listStyle = normalizeListStyleClass(node.attrs.listStyle)
				if (listStyle) {
					state.openNode('containerDirective', undefined, {
						name: LIST_DIRECTIVE_NAME,
						attributes: { class: listStyle },
					})
				}

				state
					.openNode('list', undefined, {
						ordered: false,
						spread: node.attrs.spread === true,
					})
					.next(node.content)
					.closeNode()

				if (listStyle) state.closeNode()
			},
		},
	}
})

export const setBulletListStyleCommand = $command('SetBulletListStyle', () => {
	return (listStyle?: string | null): Command => {
		return (state, dispatch) => {
			const bulletListType = state.schema.nodes.bullet_list
			if (!bulletListType) return false

			const nextStyle = normalizeListStyleClass(listStyle)
			const positions = new Map<number, PmNode>()
			const { from, to, $from } = state.selection

			for (let depth = $from.depth; depth > 0; depth--) {
				const node = $from.node(depth)
				if (node.type === bulletListType) {
					positions.set($from.before(depth), node)
					break
				}
			}

			state.doc.nodesBetween(from, to, (node, pos) => {
				if (node.type === bulletListType) positions.set(pos, node)
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
				dispatch(tr)
			}
			return true
		}
	}
})

export const styledListPlugin = [
	remarkListDirectivePlugin,
	styledBulletListSchema,
	setBulletListStyleCommand,
	(ctx: any) => () => {
		ctx.update(remarkStringifyOptionsCtx, (options: any) => ({
			...options,
			bullet: '-',
		}))
	},
].flat()
