import { remarkStringifyOptionsCtx } from '@milkdown/core'
import { bulletListAttr, bulletListSchema } from '@milkdown/preset-commonmark'
import type { Node as PmNode } from '@milkdown/prose/model'
import type { Command } from '@milkdown/prose/state'
import type { MarkdownNode, SerializerState } from '@milkdown/transformer'
import { $command, $remark } from '@milkdown/utils'
import { directiveFromMarkdown } from 'mdast-util-directive'
import { directive } from 'micromark-extension-directive'

const LIST_DIRECTIVE_NAME = 'list'
const DIRECTIVE_TYPES = new Set(['textDirective', 'leafDirective', 'containerDirective'])

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

interface DirectiveLike {
	type: string
	name?: unknown
	value?: unknown
	attributes?: unknown
	children?: DirectiveLike[]
}

function directiveMarker(type: string): string {
	if (type === 'containerDirective') return ':::'
	if (type === 'leafDirective') return '::'
	return ':'
}

// Rebuild the `{...}` attribute block from parsed directive attributes. A bare token
// like `:::youtube{id}` parses to `{ id: '' }`, so an empty value must round-trip back
// to the bare key (not `key=""`).
function stringifyAttributes(attributes: unknown): string {
	if (!attributes || typeof attributes !== 'object') return ''
	const parts: string[] = []
	for (const [key, value] of Object.entries(attributes)) {
		if (key === 'class' && typeof value === 'string') {
			for (const cls of value.split(/\s+/).filter(Boolean)) parts.push(`.${cls}`)
		} else if (key === 'id' && typeof value === 'string') {
			parts.push(`#${value}`)
		} else if (value === '' || value == null) {
			parts.push(key)
		} else {
			parts.push(`${key}="${String(value)}"`)
		}
	}
	return parts.length > 0 ? `{${parts.join(' ')}}` : ''
}

// Restore a non-list directive to its literal markdown source. Once `remark-directive`
// is registered, a stray colon in prose (`klíč:hodnota`) parses as a `textDirective` —
// which has no Milkdown node, and Milkdown throws on unknown node types. Turning it back
// into text keeps the editor alive without dropping the user's content.
function neutralizeDirective(node: DirectiveLike): DirectiveLike[] {
	const marker = directiveMarker(node.type)
	const name = typeof node.name === 'string' ? node.name : ''
	const label = Array.isArray(node.children) ? node.children : []
	const attributes = stringifyAttributes(node.attributes)

	if (node.type === 'textDirective') {
		const parts: DirectiveLike[] = [{ type: 'text', value: `${marker}${name}` }]
		if (label.length > 0) parts.push({ type: 'text', value: '[' }, ...label, { type: 'text', value: ']' })
		if (attributes) parts.push({ type: 'text', value: attributes })
		return parts
	}

	const opener: DirectiveLike = { type: 'paragraph', children: [{ type: 'text', value: `${marker}${name}${attributes}` }] }
	return [opener, ...label]
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

		// Recurse depth-first so nested directives are restored before we touch this node.
		transformListDirectives(child)

		// Any directive node still standing would crash Milkdown — restore it to text.
		if (child && DIRECTIVE_TYPES.has(child.type)) {
			const replacement = child.type === 'containerDirective' && child.name === LIST_DIRECTIVE_NAME
				? (Array.isArray(child.children) ? child.children : []) // bare `:::list` without a usable class: unwrap, keep the list
				: neutralizeDirective(child)
			parent.children.splice(index, 1, ...replacement)
			index += replacement.length - 1
		}
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

// Parse-only directive support. Registering the micromark + fromMarkdown extensions means
// directive syntax (`:::list{.class}`, a stray `klíč:hodnota`) is claimed during parsing,
// so `remark-mdx` never feeds the `{...}` to acorn ("Could not parse expression with
// acorn"). We deliberately skip `directiveToMarkdown`: its `unsafe` rules would escape
// every `:` in serialized prose (`klíč\:hodnota`), corrupting content on save.
function remarkDirectiveParseOnly(this: { data: () => any }) {
	const data = this.data()
	const micromarkExtensions = data.micromarkExtensions || (data.micromarkExtensions = [])
	micromarkExtensions.push(directive())
	const fromMarkdownExtensions = data.fromMarkdownExtensions || (data.fromMarkdownExtensions = [])
	fromMarkdownExtensions.push(directiveFromMarkdown())
}

export const remarkDirectivePlugin: any = $remark('remarkDirective', () => remarkDirectiveParseOnly as any)

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

// Directive parsing + the list transform + the schema, without the styled-list UI
// command or the `-` bullet normalization. Loaded for `.mdx` editing even when a site
// has no list styles configured, so `:::list{.class}` and stray colons in MDX content
// don't crash acorn — while plain bullet lists keep their default `*` serialization.
export const mdxDirectiveSafetyPlugin = [
	remarkDirectivePlugin,
	remarkListDirectivePlugin,
	styledBulletListSchema,
].flat()

export const styledListPlugin = [
	remarkDirectivePlugin,
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
