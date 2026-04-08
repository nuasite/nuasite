/**
 * Text-node walker scoped to a single element.
 *
 * Used by `range-anchor.ts` to locate suggestion anchors after page reloads
 * (and Phase 3 selection capture). The walker treats the element's text
 * content as a single string and remembers offsets back into the underlying
 * text nodes so we can build a DOM `Range` from a substring match.
 */

export interface TextNodeOffset {
	node: Text
	start: number
	end: number
}

/**
 * Collect every text node inside `el` (in document order) along with the
 * cumulative character offset where each node starts within the joined text.
 */
export function collectTextNodes(el: Element): { joined: string; nodes: TextNodeOffset[] } {
	const nodes: TextNodeOffset[] = []
	let joined = ''
	const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
	let cur = walker.nextNode() as Text | null
	while (cur) {
		const text = cur.nodeValue ?? ''
		nodes.push({ node: cur, start: joined.length, end: joined.length + text.length })
		joined += text
		cur = walker.nextNode() as Text | null
	}
	return { joined, nodes }
}

/**
 * Map an absolute character offset back to a `(node, offsetInNode)` pair.
 * Returns null if the offset is outside the element.
 */
export function offsetToNode(nodes: TextNodeOffset[], offset: number): { node: Text; offset: number } | null {
	for (const n of nodes) {
		if (offset >= n.start && offset <= n.end) {
			return { node: n.node, offset: offset - n.start }
		}
	}
	return null
}

/**
 * Build a DOM `Range` covering `[start, end)` (in joined-text coordinates)
 * inside the element. Returns null if either endpoint is out of bounds.
 */
export function rangeFromOffsets(el: Element, start: number, end: number): Range | null {
	const { joined, nodes } = collectTextNodes(el)
	if (start < 0 || end > joined.length || start >= end) return null
	const startPos = offsetToNode(nodes, start)
	const endPos = offsetToNode(nodes, end)
	if (!startPos || !endPos) return null
	const range = el.ownerDocument.createRange()
	range.setStart(startPos.node, startPos.offset)
	range.setEnd(endPos.node, endPos.offset)
	return range
}
