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

/**
 * Offset of the `/` that makes the tag at `[start, end)` self-closing, or -1.
 * The slash is self-closing unless it is the tail of an unquoted attribute
 * value: `<img src=/x/>` and `<a href=/>` are not self-closing, while `<br/>`,
 * `<div hidden/>` and `<img src="a"/>` are.
 */
export function selfClosingSlash(text: string, start: number, end: number): number {
	const slash = end - 2
	if (slash <= start || text[slash] !== '/') return -1
	const before = text[slash - 1]!
	if (/[\s"'}]/.test(before)) return slash
	// The run of non-space characters the slash ends: a tag name, a boolean
	// attribute, or `name=value` with the value unquoted.
	const head = text.slice(start, slash)
	const run = head.slice(Math.max(head.lastIndexOf(' '), head.lastIndexOf('\t'), head.lastIndexOf('\n')) + 1)
	return run.includes('=') ? -1 : slash
}

interface TagToken {
	start: number
	end: number
	name: string
	closing: boolean
	selfClosing: boolean
}

/**
 * The tags of `text` in order, in one pass. HTML comments, JSX block comments, the
 * frontmatter, quoted attribute values and `{…}` expressions inside a tag, and
 * the content of raw-text elements (`<script>`, `<style>`) are stepped over, so
 * a `<li>` written inside any of them is not a tag. A string in a template
 * expression (`{'<li>'}`) is not stepped over.
 */
function tokenize(text: string): TagToken[] {
	const tokens: TagToken[] = []
	const tagName = /^<(\/?)([a-zA-Z][\w:.-]*)/
	let lower: string | undefined
	// Regions that are code, not markup: the frontmatter fence and JSX block
	// comments in the template. A `'</li>'` in either is not a tag.
	const skipped: Array<[number, number]> = []
	const fence = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/.exec(text)
	if (fence) skipped.push([0, fence[0].length])
	for (const comment of text.matchAll(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g)) skipped.push([comment.index, comment.index + comment[0].length])
	let nextSkip = 0
	let i = text.indexOf('<')
	while (i >= 0 && i < text.length) {
		while (nextSkip < skipped.length && skipped[nextSkip]![1] <= i) nextSkip++
		const region = skipped[nextSkip]
		if (region && region[0] <= i) {
			i = text.indexOf('<', region[1])
			continue
		}
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
		tokens.push({ start: i, end, name, closing, selfClosing: !closing && selfClosingSlash(text, i, end) >= 0 })
		i = end
		// Only the HTML element: a `<Title>` or `<Script>` component holds markup.
		if (!closing && RAW_TEXT_ELEMENTS.has(name)) {
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
	return allElements(text).filter(e => e.start >= from && e.start < to && (!wanted || e.tag === wanted))
}

// One save looks up elements in the same file several times (each candidate,
// each rival check, each change), so the last file's elements are kept.
let lastText: string | undefined
let lastElements: ElementSpan[] = []

function allElements(text: string): ElementSpan[] {
	if (text === lastText) return lastElements
	const open = new Map<string, TagToken[]>()
	const found: ElementSpan[] = []
	for (const token of tokenize(text)) {
		const lower = token.name.toLowerCase()
		const key = token.name === lower ? lower : token.name
		if (token.closing) {
			const opener = open.get(key)?.pop()
			if (opener) {
				found.push({ start: opener.start, openEnd: opener.end, closeStart: token.start, end: token.end, tag: lower, name: opener.name, void: false })
			}
			continue
		}
		// A capitalized `<Link>` or `<Input>` is a component with children, not a void element.
		if (token.selfClosing || (token.name === lower && VOID_ELEMENTS.has(lower))) {
			found.push({ start: token.start, openEnd: token.end, closeStart: token.end, end: token.end, tag: lower, name: token.name, void: true })
			continue
		}
		if (!open.has(key)) open.set(key, [])
		open.get(key)!.push(token)
	}
	lastText = text
	lastElements = found.sort((a, b) => a.start - b.start)
	return lastElements
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
	shy: '\u00AD',
	copy: '\u00A9',
	reg: '\u00AE',
	trade: '\u2122',
	times: '\u00D7',
	euro: '\u20AC',
}

function decodeEntities(text: string): string {
	return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
		const code = hex ? parseInt(hex, 16) : dec ? parseInt(dec, 10) : -1
		if (code >= 0) return code <= 0x10FFFF ? String.fromCodePoint(code) : whole
		return NAMED_ENTITIES[name!.toLowerCase()] ?? whole
	})
}

const PLACEHOLDER = /\{\{cms:[^}]+\}\}/g
/** A `{…}` expression in template text, without nested braces. */
const EXPRESSION = /\{[^{}]*\}/g
/** Stands in for a placeholder or an expression while comparing text. */
const HOLE = '\u0000'

/**
 * The text markup renders, with whitespace collapsed and the escapes the search
 * index folds (see `normalizeText`) undone, but its case kept.
 */
function renderedCased(markup: string): string {
	return decodeEntities(
		markup.replace(/<br\b[^>]*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\\(['"])/g, '$1'),
	)
		.replace(/\u00AD/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}

/** The text an element's inner markup renders, normalized for comparison. */
export function renderedText(innerMarkup: string): string {
	return renderedCased(innerMarkup).toLowerCase()
}

/** Rendered text with every placeholder and expression reduced to one `HOLE`. */
function withHoles(text: string): string {
	return renderedCased(text.replace(PLACEHOLDER, HOLE).replace(EXPRESSION, HOLE)).replace(new RegExp(`\\s*${HOLE}\\s*`, 'g'), HOLE)
}

/**
 * Does `pattern`, with each `HOLE` standing for any text, match the whole of
 * `text`? Matched part by part, leftmost first, which is exact for wildcards
 * and linear (a backtracking regex is not).
 */
function matchesWithHoles(pattern: string, text: string): boolean {
	if (!pattern.includes(HOLE)) return pattern === text
	const parts = pattern.split(HOLE)
	const first = parts[0]!
	const last = parts[parts.length - 1]!
	if (first.length + last.length > text.length || !text.startsWith(first) || !text.endsWith(last)) return false
	let at = first.length
	const limit = text.length - last.length
	for (const middle of parts.slice(1, -1)) {
		const found = text.indexOf(middle, at)
		if (found < 0 || found + middle.length > limit) return false
		at = found + middle.length
	}
	return true
}

/** How well a candidate's text matches: 0 not at all, higher is better. */
type Fit = 0 | 1 | 2 | 3

/**
 * How well markup renders `elementText`.
 *
 * Either side can have holes. The manifest writes a nested CMS element into its
 * parent's text as `{{cms:cms-5}}`, which stands for whatever the child renders;
 * the source can have a `{expression}` that rendered as some text. The parts
 * around the holes on one side have to appear, in order, in the other.
 *
 * Exact case beats a case-only difference (3 over 2). Markup that is nothing
 * but expressions matches any text, so it only fits weakly (1): it can stand for
 * the element when nothing else on the line does.
 */
function textFit(innerMarkup: string, elementText: string): Fit {
	const source = withHoles(innerMarkup)
	const wanted = withHoles(elementText)
	const fits = (a: string, b: string) => matchesWithHoles(a, b) || matchesWithHoles(b, a)
	if (!fits(source.toLowerCase(), wanted.toLowerCase())) return 0
	if (!source.replaceAll(HOLE, '').trim()) return 1
	return fits(source, wanted) ? 3 : 2
}

/** Does markup render `elementText`? */
export function rendersText(innerMarkup: string, elementText: string): boolean {
	return textFit(innerMarkup, elementText) > 0
}

/** The quoted attribute values of an opening tag. */
function attributeValues(openingTag: string): string[] {
	return [...openingTag.matchAll(/\s[\w:-]+\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => decodeEntities(m[1] ?? m[2] ?? ''))
}

/** How well this candidate stands for the element whose manifest text is `elementText`. */
function candidateFit(text: string, candidate: ElementSpan, elementText: string): Fit {
	// A void element renders no text; the manifest's text for one (an image's alt or src) is an attribute value.
	if (candidate.void) return attributeValues(text.slice(candidate.start, candidate.openEnd)).includes(elementText.trim()) ? 3 : 0
	return textFit(text.slice(candidate.openEnd, candidate.closeStart), elementText)
}

/**
 * Of the candidate elements, the one the edit is about.
 *
 * When the element's text is known, the candidate has to render it, even when
 * it is the only one. Without the text, a lone candidate is taken. The best fit
 * wins (see `textFit`); when no candidate fits, or more than one fits equally
 * well at the best level, the answer is `null` and the caller keeps its
 * whole-line behaviour rather than guess.
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
	if (!known) return candidates.length === 1 ? candidates[0]! : null

	const fits = candidates.map(c => ({ candidate: c, fit: candidateFit(text, c, elementText!) }))
	const best = Math.max(0, ...fits.map(f => f.fit))
	const matching = fits.filter(f => f.fit === best && best > 0)
	if (matching.length !== 1) return null
	const picked = matching[0]!.candidate

	const from = rivals?.from ?? 0
	const to = rivals?.to ?? text.length
	const components = findElements(text, from, to).filter(c => c.name !== c.tag && c.start !== picked.start)
	if (components.some(c => candidateFit(text, c, elementText!) >= best)) return null
	const wanted = withHoles(elementText!).toLowerCase()
	for (const link of text.slice(from, to).matchAll(/\[([^\]\n]+)\]\(/g)) {
		if (withHoles(link[1]!).toLowerCase() === wanted) return null
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
