import type { Plugin } from 'vite'
import { buildMapPattern } from './handlers/array-ops'
import { findFrontmatterEnd } from './handlers/component-ops'

/**
 * Vite transform plugin that injects `data-cms-array-source` markers on root HTML
 * elements inside `.map()` callbacks in Astro template sections.
 *
 * This enables the CMS to detect inline array-rendered HTML elements (not just
 * named Astro components) and provide add/remove array item operations.
 *
 * Only targets lowercase tags (inline HTML). Uppercase tags (components) are
 * already supported via `data-astro-source-file` tracking.
 */
export function createArrayTransformPlugin(): Plugin {
	return {
		name: 'cms-array-transform',
		enforce: 'pre',
		transform(code, id) {
			if (!id.endsWith('.astro')) return null

			// Find template section (after closing ---)
			const templateStart = findTemplateStart(code)
			if (templateStart < 0) return null

			const template = code.slice(templateStart)
			const transformed = injectArraySourceMarkers(template)
			if (transformed === template) return null

			return {
				code: code.slice(0, templateStart) + transformed,
				map: null,
			}
		},
	}
}

/**
 * Find the start of the template section in an Astro file.
 * The template starts after the closing `---` of the frontmatter block.
 */
export function findTemplateStart(code: string): number {
	const lines = code.split('\n')
	const fmEndLine = findFrontmatterEnd(lines)
	if (fmEndLine === 0) return 0 // No frontmatter, whole file is template

	// Convert line index back to character offset
	let offset = 0
	for (let i = 0; i < fmEndLine; i++) {
		offset += lines[i]!.length + 1 // +1 for the newline
	}
	return offset
}

/**
 * Scan the template section for `.map(` patterns that render inline HTML elements,
 * and inject `data-cms-array-source="varName"` on the root element.
 */
export function injectArraySourceMarkers(template: string): string {
	// Match patterns like: {varName.map((item) => (  or {varName.map(item =>
	// We process each match individually
	const mapPattern = new RegExp(buildMapPattern(), 'g')
	let result = template
	let offset = 0
	// Track how many .map() calls we've seen per variable name
	const varMapCounts = new Map<string, number>()

	for (const match of template.matchAll(mapPattern)) {
		const arrayVarName = match[1]!
		const matchEnd = match.index! + match[0].length

		// Scan forward from the match to find the arrow `=>` and then the first `<tag`
		const afterMatch = template.slice(matchEnd)
		const arrowIndex = afterMatch.indexOf('=>')
		if (arrowIndex < 0) continue

		const afterArrow = afterMatch.slice(arrowIndex + 2)
		// Find the first opening tag: `<tagName` where tagName starts with a letter.
		// Supports multiple patterns:
		//   => <tag               (direct return)
		//   => (<tag              (parenthesized)
		//   => { return <tag      (block body)
		//   => { return (<tag     (block body, parenthesized)
		//   => expr && <tag       (logical AND conditional)
		//   => cond ? <tag        (ternary conditional)
		const tagMatch = afterArrow.match(/^[\s(]*<([a-zA-Z][\w.-]*)/)
			?? afterArrow.match(/^[\s]*\{[\s]*return[\s(]*<([a-zA-Z][\w.-]*)/)
			?? afterArrow.match(/^[\s(]*[^<]*?&&\s*[\s(]*<([a-zA-Z][\w.-]*)/)
			?? afterArrow.match(/^[\s(]*[^<]*?\?\s*[\s(]*<([a-zA-Z][\w.-]*)/)
		if (!tagMatch) continue

		const tagName = tagMatch[1]!
		// Skip uppercase tags (Astro components) — they are already supported
		if (tagName[0] === tagName[0]!.toUpperCase() && tagName[0] !== tagName[0]!.toLowerCase()) continue

		// Find the exact position of this `<tagName` in the original template
		const tagStartInAfterArrow = afterArrow.indexOf(tagMatch[0])
		const absoluteTagPos = matchEnd + arrowIndex + 2 + tagStartInAfterArrow
		// Position right after `<tagName`
		const insertPos = absoluteTagPos + tagMatch[0].length

		// Check if the attribute is already injected (search to closing >)
		const closingBracket = template.indexOf('>', insertPos)
		const searchEnd = closingBracket >= 0 ? closingBracket : template.length
		const alreadyHasAttr = template.slice(insertPos, searchEnd).includes('data-cms-array-source')
		if (alreadyHasAttr) continue

		// Track occurrence index per variable name (for multiple .map() of same array)
		const mapIndex = varMapCounts.get(arrayVarName) ?? 0
		varMapCounts.set(arrayVarName, mapIndex + 1)
		const attrValue = mapIndex === 0 ? arrayVarName : `${arrayVarName}#${mapIndex}`

		const injection = ` data-cms-array-source="${attrValue}"`
		result = result.slice(0, insertPos + offset) + injection + result.slice(insertPos + offset)
		offset += injection.length
	}

	return result
}
