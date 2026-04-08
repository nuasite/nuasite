/**
 * Anchor-text re-attachment for range suggestions.
 *
 * Suggestions don't store character offsets — they store the original
 * substring (`anchorText`). On reload we walk the target element's text
 * nodes and look for that substring. If found, we return a DOM `Range`
 * the overlay can use to draw highlights or compute coordinates. If not
 * found, the suggestion is reported as stale so the sidebar can surface
 * a re-attach CTA.
 *
 * The matching is intentionally simple: first exact match, then a
 * collapsed-whitespace fallback (handles HTML re-flowing). Anything more
 * sophisticated (fuzzy / Levenshtein) waits for a real-world failure.
 */

import { collectTextNodes, rangeFromOffsets } from './dom-walker'

export interface AnchorMatch {
	range: Range
	rect: DOMRect
	start: number
	end: number
}

function collapseWhitespace(s: string): string {
	return s.replace(/\s+/g, ' ').trim()
}

export function findAnchorRange(el: Element, anchorText: string): AnchorMatch | null {
	if (!anchorText) return null
	const { joined } = collectTextNodes(el)
	if (!joined) return null

	// 1. Exact substring match
	const idx = joined.indexOf(anchorText)
	if (idx >= 0) {
		const range = rangeFromOffsets(el, idx, idx + anchorText.length)
		if (range) return { range, rect: range.getBoundingClientRect(), start: idx, end: idx + anchorText.length }
	}

	// 2. Whitespace-collapsed fallback. Build a map from collapsed offsets back
	//    to original offsets so we can still produce a real DOM range.
	const collapsedAnchor = collapseWhitespace(anchorText)
	if (!collapsedAnchor) return null
	const map: number[] = [] // collapsed index → original index
	let collapsed = ''
	let prevWs = false
	for (let i = 0; i < joined.length; i++) {
		const ch = joined[i]!
		const isWs = /\s/.test(ch)
		if (isWs) {
			if (collapsed.length === 0) continue // leading
			if (prevWs) continue
			collapsed += ' '
			map.push(i)
			prevWs = true
		} else {
			collapsed += ch
			map.push(i)
			prevWs = false
		}
	}
	const trimmed = collapsed.replace(/\s+$/, '')
	const cIdx = trimmed.indexOf(collapsedAnchor)
	if (cIdx < 0) return null
	const startOrig = map[cIdx]
	const endOrigInclusive = map[cIdx + collapsedAnchor.length - 1]
	if (startOrig == null || endOrigInclusive == null) return null
	const range = rangeFromOffsets(el, startOrig, endOrigInclusive + 1)
	if (!range) return null
	return { range, rect: range.getBoundingClientRect(), start: startOrig, end: endOrigInclusive + 1 }
}

/**
 * Compute the substring of an element's joined text inside the user's
 * current selection. Returns null if the selection is empty or not fully
 * inside the element.
 */
export function selectionInsideElement(el: Element, selection: Selection): { text: string; rect: DOMRect } | null {
	if (selection.rangeCount === 0) return null
	const range = selection.getRangeAt(0)
	if (range.collapsed) return null
	if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null
	const text = range.toString()
	if (!text.trim()) return null
	return { text, rect: range.getBoundingClientRect() }
}
