import type { AstroConfig } from 'astro'
import remarkDirective from 'remark-directive'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

const mdx = unified().use(remarkParse).use(remarkMdx)
const mdxWithDirectives = unified().use(remarkParse).use(remarkMdx).use(remarkDirective)

export interface MarkdownSyntax {
	/**
	 * The site's markdown pipeline parses directives (`:::list{.dots}`). MDX then reads a `{…}` after a
	 * directive as its attributes; without them it is an expression.
	 */
	directives: boolean
}

/**
 * The syntax of the site's markdown pipeline, which `@astrojs/mdx` extends by default: directives when a
 * remark-directive plugin is in it (`@nuasite/nua` adds the CMS's). Plugins given to `mdx()` alone are not
 * visible here. Since Astro 7 the plugins sit on the `unified()` processor; the deprecated top-level
 * `markdown.remarkPlugins` is read too.
 */
export function markdownSyntaxOf(config: AstroConfig): MarkdownSyntax {
	const processor = config.markdown?.processor
	const processorPlugins = processor?.name === 'unified' ? (processor.options as { remarkPlugins?: unknown[] }).remarkPlugins : undefined
	const plugins = [...(config.markdown?.remarkPlugins ?? []), ...(processorPlugins ?? [])]
	const directives = plugins.some(entry => {
		const plugin = Array.isArray(entry) ? entry[0] : entry
		return plugin === 'remark-directive' || (typeof plugin === 'function' && plugin.name === 'remarkDirective')
	})
	return { directives }
}

/**
 * Make an `.mdx` entry body readable as plain markdown, or say it cannot be.
 *
 * The body is parsed as MDX, so fences, multi-line ESM and code spans follow the same rules MDX itself
 * uses. ESM (`import`/`export`) is cut out of the source: none of it is content. A body that still renders
 * something the source only names returns `undefined`, so the page's rendered HTML is used instead:
 * a component (`<Card title="…" />`), an expression (`{new Date().getFullYear()}`, `{/* note *\/}`) or a
 * plain HTML tag whose attributes are expressions. A body MDX cannot parse returns `undefined` too.
 * `syntax` says which extensions the site parses MDX with, so the body reads as the site renders it.
 */
export function mdxBodyAsMarkdown(body: string, syntax: MarkdownSyntax): string | undefined {
	let tree: Node
	try {
		tree = (syntax.directives ? mdxWithDirectives : mdx).parse(body)
	} catch {
		return undefined
	}

	const esm: Array<[number, number]> = []
	let rendersMore = false
	visit(tree, node => {
		if (node.type === 'mdxjsEsm') {
			const start = node.position?.start.offset
			const end = node.position?.end.offset
			if (start === undefined || end === undefined) rendersMore = true
			else esm.push([start, end])
		} else if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') {
			rendersMore = true
		} else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
			if (!isPlainHtml(node as JsxElement)) rendersMore = true
		}
		return !rendersMore
	})
	if (rendersMore) return undefined

	let out = ''
	let from = 0
	for (const [start, end] of esm) {
		out += body.slice(from, start)
		// The blank lines that separated the block go with it.
		from = end
		while (body[from] === '\n' || body[from] === '\r') from++
	}
	out += body.slice(from)
	return out
}

interface Node {
	type: string
	position?: { start: { offset?: number }; end: { offset?: number } }
	children?: Node[]
}

interface JsxElement extends Node {
	name: string | null
	attributes: Array<{ type: string; value?: unknown }>
}

/** A lowercase tag (`<div class="note">`) with literal attributes renders as written; a fragment or component does not. */
function isPlainHtml(node: JsxElement): boolean {
	if (!node.name || !/^[a-z][\w-]*$/.test(node.name)) return false
	return node.attributes.every(attr => attr.type === 'mdxJsxAttribute' && (attr.value === null || typeof attr.value === 'string'))
}

/** Depth-first walk that stops as soon as `enter` returns false. */
function visit(node: Node, enter: (node: Node) => boolean): boolean {
	if (!enter(node)) return false
	for (const child of node.children ?? []) {
		if (!visit(child, enter)) return false
	}
	return true
}
