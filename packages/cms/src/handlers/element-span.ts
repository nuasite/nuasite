import { normalizeText } from '../source-finder/snippet-utils'

/**
 * Locating one element inside source markup, by string scanning.
 *
 * Source locations are line-granular: the manifest knows the line an element
 * starts on, and its snippet holds whole lines. A line can carry more than the
 * element, though: the parent's `<ul>` or `</ul>`, a sibling `<li>`, a `<span>`
 * that happens to contain the same word. Every write has to land on the edited
 * element and nowhere else, so the writer narrows a line or a snippet down to
 * that element's span first.
 *
 * The Astro compiler's AST is not used here because its end positions and its
 * offsets after non-ASCII text are unreliable, and the files written include
 * markdown and MDX that it does not parse.
 */

export interface ElementSpan {
	/** Offset of the `<` that opens the element. */
	start: number
	/** Offset just past the opening tag's `>`. */
	openEnd: number
	/** Offset of the closing tag, or `openEnd` for a void or self-closing element. */
	closeStart: number
	/** Offset just past the closing tag, or `openEnd` for a void or self-closing element. */
	end: number
	/** Lowercased tag name. */
	tag: string
	/** The tag name as written, so a component (`<Button>`) can be told from an element. */
	name: string
	/** True for a void or self-closing element, which has no inner content. */
	void: boolean
}

const VOID_ELEMENTS = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'param',
	'source',
	'track',
	'wbr',
])

/** Elements whose content is not markup: a `<li>` inside a script string is not an element. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title'])

/**
 * Offset just past the `>` that ends the tag opened at `start`, skipping `>`
 * inside quoted attribute values and `{…}` expressions. Returns -1 when the tag
 * never closes.
 */
export function tagEnd(text: string, start: number): number {
	let quote: string | null = null
	let braces = 0
	for (let i = start + 1; i < text.length; i++) {
		const ch = text[i]!
		if (quote) {
			if (ch === quote) quote = null
			continue
		}
		if (braces > 0) {
			if (ch === '{') braces++
			else if (ch === '}') braces--
			else if (ch === '"' || ch === "'" || ch === '`') quote = ch
			continue
		}
		if (ch === '"' || ch === "'") quote = ch
		else if (ch === '{') braces++
		else if (ch === '>') return i + 1
	}
	return -1
}

/** Offset of the first character of 1-based `line`, or -1 past the end of the text. */
export function lineStart(text: string, line: number): number {
	let offset = 0
	for (let current = 1; current < line; current++) {
		const next = text.indexOf('\n', offset)
		if (next < 0) return -1
		offset = next + 1
	}
	return offset
}

/** Offset just past the end of the line that `offset` sits on (before its `\n`). */
export function lineEnd(text: string, offset: number): number {
	const next = text.indexOf('\n', offset)
	return next < 0 ? text.length : next
}

/** 1-based line number of `offset`. */
export function lineOf(text: string, offset: number): number {
	let line = 1
	for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) line++
	return line
}

/**
 * Where `snippet` sits in `content`, preferring the occurrence that covers
 * `line` (the element's own line) over an identical one elsewhere in the file.
 * Returns -1 when the snippet is not in the file.
 */
export function locateSnippet(content: string, snippet: string, line?: number): number {
	const first = content.indexOf(snippet)
	if (first < 0 || !line || line < 1) return first

	const span = snippet.match(/\n/g)?.length ?? 0
	let best = first
	let bestDistance = Number.POSITIVE_INFINITY
	// Lines are counted incrementally from one occurrence to the next.
	let countedTo = 0
	let startLine = 1
	for (let at = first; at >= 0; at = content.indexOf(snippet, at + 1)) {
		for (let i = content.indexOf('\n', countedTo); i >= 0 && i < at; i = content.indexOf('\n', i + 1)) startLine++
		countedTo = at
		const endLine = startLine + span
		const distance = line < startLine ? startLine - line : line > endLine ? line - endLine : 0
		if (distance < bestDistance) {
			best = at
			bestDistance = distance
		}
		if (distance === 0 || startLine > line) break
	}
	return best
}

interface TagToken {
	start: number
	end: number
	name: string
	closing: boolean
	selfClosing: boolean
}

/**
 * The tags of `text` in order, in one pass. Comments, quoted attribute values,
 * `{…}` expressions and the content of raw-text elements (`<script>`, `<style>`)
 * are stepped over, so a `<li>` written inside any of them is not a tag.
 */
function tokenize(text: string): TagToken[] {
	const tokens: TagToken[] = []
	const tagName = /^<(\/?)([a-zA-Z][\w:.-]*)/
	let lower: string | undefined
	let i = text.indexOf('<')
	while (i >= 0 && i < text.length) {
		if (text.startsWith('<!--', i)) {
			const close = text.indexOf('-->', i + 4)
			if (close < 0) break
			i = text.indexOf('<', close + 3)
			continue
		}
		const match = tagName.exec(text.slice(i, i + 64))
		if (!match) {
			i = text.indexOf('<', i + 1)
			continue
		}
		const end = tagEnd(text, i)
		if (end < 0) break
		const name = match[2]!
		const closing = match[1] === '/'
		tokens.push({ start: i, end, name, closing, selfClosing: !closing && text[end - 2] === '/' })
		i = end
		if (!closing && RAW_TEXT_ELEMENTS.has(name.toLowerCase())) {
			lower ??= text.toLowerCase()
			const close = lower.indexOf(`</${name.toLowerCase()}`, end)
			if (close < 0) break
			i = close
			continue
		}
		i = text.indexOf('<', i)
	}
	return tokens
}

/**
 * Every element named `tag` (any element when `tag` is omitted) whose opening
 * tag starts within `[from, to)`. Closing tags are paired with a stack per name,
 * so a nested element of the same name does not end its parent early, and an
 * element whose closing tag is missing is left out.
 */
export function findElements(text: string, from: number, to: number, tag?: string): ElementSpan[] {
	const wanted = tag?.toLowerCase()
	const open = new Map<string, TagToken[]>()
	const found: ElementSpan[] = []
	for (const token of tokenize(text)) {
		const lower = token.name.toLowerCase()
		const key = token.name === lower ? lower : token.name
		if (token.closing) {
			const opener = open.get(key)?.pop()
			if (opener && opener.start >= from && opener.start < to && (!wanted || lower === wanted)) {
				found.push({ start: opener.start, openEnd: opener.end, closeStart: token.start, end: token.end, tag: lower, name: opener.name, void: false })
			}
			continue
		}
		if (token.selfClosing || VOID_ELEMENTS.has(lower)) {
			if (token.start >= from && token.start < to && (!wanted || lower === wanted)) {
				found.push({ start: token.start, openEnd: token.end, closeStart: token.end, end: token.end, tag: lower, name: token.name, void: true })
			}
			continue
		}
		if (!open.has(key)) open.set(key, [])
		open.get(key)!.push(token)
	}
	return found.sort((a, b) => a.start - b.start)
}

/** Named entities common in hand-written markup. */
export const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00A0',
	ndash: '\u2013',
	mdash: '\u2014',
	hellip: '\u2026',
	laquo: '\u00AB',
	raquo: '\u00BB',
	lsquo: '\u2018',
	rsquo: '\u2019',
	ldquo: '\u201C',
	rdquo: '\u201D',
	bdquo: '\u201E',
	sbquo: '\u201A',
	shy: '',
	copy: '\u00A9',
	reg: '\u00AE',
	trade: '\u2122',
	times: '\u00D7',
	euro: '\u20AC',
}

function decodeEntities(text: string): string {
	return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
		if (hex) return String.fromCodePoint(parseInt(hex, 16))
		if (dec) return String.fromCodePoint(parseInt(dec, 10))
		return NAMED_ENTITIES[name!.toLowerCase()] ?? whole
	})
}

const PLACEHOLDER = /\{\{cms:[^}]+\}\}/g
/** A `{…}` expression in template text, without nested braces. */
const EXPRESSION = /\{[^{}]*\}/g
/** Stands in for a placeholder or an expression while comparing text. */
const HOLE = '\u0000'

/** The text an element's inner markup renders, normalized the way the search index normalizes it. */
export function renderedText(innerMarkup: string): string {
	return normalizeText(decodeEntities(innerMarkup.replace(/<br\b[^>]*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '')))
}

/** Normalized text with every placeholder and expression reduced to one `HOLE`. */
function withHoles(text: string): string {
	return renderedText(text.replace(PLACEHOLDER, HOLE).replace(EXPRESSION, HOLE)).replace(new RegExp(`\\s*${HOLE}\\s*`, 'g'), HOLE)
}

/** Does `text` contain `parts` in order, the first at its start and the last at its end? */
function containsInOrder(text: string, parts: string[]): boolean {
	const first = parts[0]!
	const last = parts[parts.length - 1]!
	if (!text.startsWith(first) || !text.endsWith(last) || first.length + last.length > text.length) return false
	let at = first.length
	for (const middle of parts.slice(1, -1)) {
		if (!middle) continue
		const found = text.indexOf(middle, at)
		if (found < 0) return false
		at = found + middle.length
	}
	return at <= text.length - last.length
}

/**
 * Does markup render `elementText`?
 *
 * Either side can have holes. The manifest writes a nested CMS element into its
 * parent's text as `{{cms:cms-5}}`, which stands for whatever the child renders;
 * the source can have a `{expression}` that rendered as some text. The parts
 * around the holes on one side have to appear, in order, in the other.
 */
export function rendersText(innerMarkup: string, elementText: string): boolean {
	const source = withHoles(innerMarkup)
	const wanted = withHoles(elementText)
	if (!source.includes(HOLE) && !wanted.includes(HOLE)) return source === wanted
	if (source.includes(HOLE) && wanted.includes(HOLE)) return source === wanted
	return source.includes(HOLE)
		? containsInOrder(wanted, source.split(HOLE).map(part => part.trim()))
		: containsInOrder(source, wanted.split(HOLE).map(part => part.trim()))
}

/** The quoted attribute values of an opening tag. */
function attributeValues(openingTag: string): string[] {
	return [...openingTag.matchAll(/\s[\w:-]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => decodeEntities(m[1] ?? m[2] ?? ''))
}

/** Does this candidate stand for the element whose manifest text is `elementText`? */
function candidateFits(text: string, candidate: ElementSpan, elementText: string): boolean {
	// A void element renders no text; the manifest's text for one (an image's alt or src) is an attribute value.
	if (candidate.void) return attributeValues(text.slice(candidate.start, candidate.openEnd)).includes(elementText.trim())
	return rendersText(text.slice(candidate.openEnd, candidate.closeStart), elementText)
}

/**
 * Of the candidate elements, the one the edit is about.
 *
 * When the element's text is known, the candidate has to render it, even when
 * it is the only one. Without the text, a lone candidate is taken. When no
 * candidate, or more than one, fits, the answer is `null` and the caller keeps
 * its whole-line behaviour rather than guess.
 *
 * `rivals` are what else in the same stretch could be the rendered element: a
 * component (`<Button>` may render the `<a>` being edited) or a markdown link
 * that renders the same text. Either one makes the pick a guess, so it is
 * declined.
 */
export function pickElement(
	text: string,
	candidates: ElementSpan[],
	elementText: string | undefined,
	rivals?: { from: number; to: number },
): ElementSpan | null {
	const known = !!elementText && !!renderedText(elementText.replace(PLACEHOLDER, ''))
	const matching = known ? candidates.filter(c => candidateFits(text, c, elementText!)) : candidates
	if (matching.length !== 1) return null
	const picked = matching[0]!

	const from = rivals?.from ?? 0
	const to = rivals?.to ?? text.length
	if (known) {
		const components = findElements(text, from, to).filter(c => c.name !== c.tag && c.start !== picked.start)
		if (components.some(c => candidateFits(text, c, elementText!))) return null
		const wanted = withHoles(elementText!)
		for (const link of text.slice(from, to).matchAll(/\[([^\]\n]+)\]\(/g)) {
			if (withHoles(link[1]!) === wanted) return null
		}
	}
	return picked
}

/**
 * The element named `tag` that opens on 1-based `line` of `content` and renders
 * `elementText` (any of them, when several are given), or `null` when the line holds no such element or more than one
 * that cannot be told apart.
 */
export function elementOnLine(
	content: string,
	line: number,
	tag: string | undefined,
	elementText: string | string[] | undefined,
): ElementSpan | null {
	if (!tag) return null
	const from = lineStart(content, line)
	if (from < 0) return null
	const to = lineEnd(content, from)
	const candidates = findElements(content, from, to, tag)
	const texts = Array.isArray(elementText) ? elementText : [elementText]
	for (const text of texts) {
		const picked = pickElement(content, candidates, text, { from, to })
		if (picked) return picked
	}
	return null
}
