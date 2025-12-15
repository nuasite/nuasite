import { parse } from 'node-html-parser'
import type { ComponentInstance, ManifestEntry } from './types'

export interface ProcessHtmlOptions {
	attributeName: string
	includeTags: string[] | null
	excludeTags: string[]
	includeEmptyText: boolean
	generateManifest: boolean
	markComponents?: boolean
	componentDirs?: string[]
	excludeComponentDirs?: string[]
	markStyledSpans?: boolean
}

export interface ProcessHtmlResult {
	html: string
	entries: Record<string, ManifestEntry>
	components: Record<string, ComponentInstance>
}

/**
 * Tailwind text styling class patterns that indicate a styled span.
 * These are classes that only affect text appearance, not layout.
 */

// Known layout-affecting classes that should NOT be considered text styling
const LAYOUT_CLASS_PATTERNS = [
	// Text alignment
	/^text-(left|center|right|justify|start|end)$/,
	// Text wrapping and overflow
	/^text-(wrap|nowrap|balance|pretty|ellipsis|clip)$/,
	// Vertical alignment
	/^align-/,
	// Background attachment, size, repeat, position
	/^bg-(fixed|local|scroll)$/,
	/^bg-(auto|cover|contain)$/,
	/^bg-(repeat|no-repeat|repeat-x|repeat-y|repeat-round|repeat-space)$/,
	/^bg-clip-/,
	/^bg-origin-/,
	/^bg-(top|bottom|left|right|center)$/,
	/^bg-(top|bottom)-(left|right)$/,
]

const TEXT_STYLE_PATTERNS = [
	// Font weight
	/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\d+)$/,
	// Font style
	/^(italic|not-italic)$/,
	// Text decoration
	/^(underline|overline|line-through|no-underline)$/,
	// Text decoration style
	/^decoration-(solid|double|dotted|dashed|wavy)$/,
	// Text decoration color (any color, including custom ones)
	/^decoration-[\w-]+$/,
	// Text decoration thickness
	/^decoration-(auto|from-font|0|1|2|4|8)$/,
	// Text underline offset
	/^underline-offset-/,
	// Text transform
	/^(uppercase|lowercase|capitalize|normal-case)$/,
	// Text color (any custom color - layout classes excluded separately)
	/^text-[\w-]+$/,
	// Background color (any custom color - layout classes excluded separately)
	/^bg-[\w-]+$/,
	// Font size
	/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/,
	// Letter spacing
	/^tracking-/,
	// Line height
	/^leading-/,
]

/**
 * Check if a class is a text styling class
 */
function isTextStyleClass(className: string): boolean {
	// First check if it's a known layout class
	if (LAYOUT_CLASS_PATTERNS.some(pattern => pattern.test(className))) {
		return false
	}
	// Then check if it matches any text style pattern
	return TEXT_STYLE_PATTERNS.some(pattern => pattern.test(className))
}

/**
 * Check if all classes on an element are text styling classes
 */
function hasOnlyTextStyleClasses(classAttr: string): boolean {
	if (!classAttr || !classAttr.trim()) return false

	const classes = classAttr.split(/\s+/).filter(Boolean)
	if (classes.length === 0) return false

	// All classes must be text styling classes
	return classes.every(isTextStyleClass)
}

/**
 * Process HTML to inject CMS markers and extract manifest entries
 */
export async function processHtml(
	html: string,
	fileId: string,
	options: ProcessHtmlOptions,
	getNextId: () => string,
	sourcePath?: string,
): Promise<ProcessHtmlResult> {
	const {
		attributeName,
		includeTags,
		excludeTags,
		includeEmptyText,
		generateManifest,
		markComponents = true,
		componentDirs = ['src/components'],
		excludeComponentDirs = ['src/pages', 'src/layouts', 'src/layout'],
		markStyledSpans = true,
	} = options

	const root = parse(html, {
		lowerCaseTagName: false,
		comment: true,
		blockTextElements: {
			script: true,
			noscript: true,
			style: true,
			pre: true,
		},
	})

	const entries: Record<string, ManifestEntry> = {}
	const components: Record<string, ComponentInstance> = {}
	const sourceLocationMap = new Map<string, { file: string; line: number }>()
	const markedComponentRoots = new Set<any>()

	// First pass: detect and mark component root elements
	// A component root is detected by data-astro-source-file pointing to a component directory
	if (markComponents) {
		root.querySelectorAll('*').forEach((node) => {
			const sourceFile = node.getAttribute('data-astro-source-file')
			if (!sourceFile) return

			// Check if this element's source is from a component file
			// Exclude pages and layouts first
			const isExcludedFile = excludeComponentDirs.some(dir => {
				const normalizedDir = dir.replace(/^\/+|\/+$/g, '')
				return sourceFile.startsWith(normalizedDir + '/')
					|| sourceFile.startsWith(normalizedDir + '\\')
					|| sourceFile.includes('/' + normalizedDir + '/')
					|| sourceFile.includes('\\' + normalizedDir + '\\')
			})
			if (isExcludedFile) return

			// If componentDirs is specified, also check whitelist
			if (componentDirs.length > 0) {
				const isComponentFile = componentDirs.some(dir => {
					const normalizedDir = dir.replace(/^\/+|\/+$/g, '')
					return sourceFile.startsWith(normalizedDir + '/')
						|| sourceFile.startsWith(normalizedDir + '\\')
						|| sourceFile.includes('/' + normalizedDir + '/')
						|| sourceFile.includes('\\' + normalizedDir + '\\')
				})
				if (!isComponentFile) return
			}

			// Check if any ancestor is already marked as a component root from the same file
			// (we only want to mark the outermost element from each component)
			let parent = node.parentNode
			let ancestorFromSameComponent = false
			while (parent) {
				const parentSource = (parent as any).getAttribute?.('data-astro-source-file')
				if (parentSource === sourceFile) {
					ancestorFromSameComponent = true
					break
				}
				parent = parent.parentNode
			}

			if (ancestorFromSameComponent) return

			// This is a component root - mark it
			const id = getNextId()
			node.setAttribute('data-cms-component-id', id)
			markedComponentRoots.add(node)

			// Extract component name from file path (e.g., "src/components/Welcome.astro" -> "Welcome")
			const componentName = extractComponentName(sourceFile)
			// Parse source loc - format is "line:col" e.g. "20:21"
			const sourceLocAttr = node.getAttribute('data-astro-source-line') || '1:0'
			const sourceLine = parseInt(sourceLocAttr.split(':')[0] ?? '1', 10)

			components[id] = {
				id,
				componentName,
				file: fileId,
				sourcePath: sourceFile,
				sourceLine,
				props: {}, // Props will be filled from component definitions
			}
		})
	}

	// Second pass: mark span elements with text-only styling classes as styled spans
	// This allows the CMS editor to recognize pre-existing styled text
	if (markStyledSpans) {
		root.querySelectorAll('span').forEach((node) => {
			// Skip if already marked
			if (node.getAttribute('data-cms-styled')) return

			const classAttr = node.getAttribute('class')
			if (!classAttr) return

			// Check if the span has only text styling classes
			if (hasOnlyTextStyleClasses(classAttr)) {
				node.setAttribute('data-cms-styled', 'true')
			}
		})
	}

	// Third pass: assign IDs to all qualifying text elements and extract source locations
	root.querySelectorAll('*').forEach((node) => {
		const tag = node.tagName?.toLowerCase?.() ?? ''

		if (excludeTags.includes(tag)) return
		if (includeTags && !includeTags.includes(tag)) return
		if (node.getAttribute(attributeName)) return // Already marked

		const textContent = (node.innerText ?? '').trim()
		if (!includeEmptyText && !textContent) return

		const id = getNextId()
		node.setAttribute(attributeName, id)

		// Extract source location from Astro compiler attributes
		const sourceFile = node.getAttribute('data-astro-source-file')
		const sourceLine = node.getAttribute('data-astro-source-line')

		if (sourceFile && sourceLine) {
			const lineNum = parseInt(sourceLine.split(':')[0] ?? '1', 10)
			if (!isNaN(lineNum)) {
				sourceLocationMap.set(id, { file: sourceFile, line: lineNum })
			}
			// Only remove source attributes if this is NOT a component root
			// Component roots need these for identification
			if (!markedComponentRoots.has(node)) {
				node.removeAttribute('data-astro-source-file')
				node.removeAttribute('data-astro-source-line')
			}
		}
	})

	// Fourth pass: build manifest entries
	if (generateManifest) {
		root.querySelectorAll(`[${attributeName}]`).forEach((node) => {
			const id = node.getAttribute(attributeName)
			if (!id) return

			const tag = node.tagName?.toLowerCase?.() ?? ''

			// Get child CMS elements
			const childCmsElements = node.querySelectorAll(`[${attributeName}]`)
			const childCmsIds = Array.from(childCmsElements).map((child: any) => child.getAttribute(attributeName))

			// Build text with placeholders for child CMS elements
			// Recursively process child nodes to handle nested CMS elements correctly
			const buildTextWithPlaceholders = (nodes: any[]): string => {
				let text = ''
				for (const child of nodes) {
					if (child.nodeType === 3) {
						// Text node
						text += child.text || ''
					} else if (child.nodeType === 1) {
						// Element node
						const directCmsId = (child as any).getAttribute?.(attributeName)

						if (directCmsId) {
							// Child has a direct CMS ID - use placeholder
							text += `{{cms:${directCmsId}}}`
						} else {
							// Child doesn't have a CMS ID - recursively process its children
							text += buildTextWithPlaceholders(child.childNodes || [])
						}
					}
				}
				return text
			}

			const textWithPlaceholders = buildTextWithPlaceholders(node.childNodes || [])

			// Get direct text content (without placeholders)
			const directText = textWithPlaceholders.replace(/\{\{cms:[^}]+\}\}/g, '').trim()

			// Skip pure container elements (no direct text, only child CMS elements)
			if (!directText && childCmsIds.length > 0) {
				return
			}

			// Get source location from map (injected by Astro compiler)
			const sourceLocation = sourceLocationMap.get(id)

			// Find parent component if any
			let parentComponentId: string | undefined
			let parent = node.parentNode
			while (parent) {
				const parentCompId = (parent as any).getAttribute?.('data-cms-component-id')
				if (parentCompId) {
					parentComponentId = parentCompId
					break
				}
				parent = parent.parentNode
			}

			entries[id] = {
				id,
				file: fileId,
				tag,
				text: textWithPlaceholders.trim(),
				sourcePath: sourceLocation?.file || sourcePath,
				childCmsIds: childCmsIds.length > 0 ? childCmsIds : undefined,
				sourceLine: sourceLocation?.line,
				sourceSnippet: undefined,
				sourceType: undefined,
				variableName: undefined,
				parentComponentId,
			}
		})
	}

	// Clean up any remaining source attributes from component-marked elements
	markedComponentRoots.forEach((node: any) => {
		node.removeAttribute('data-astro-source-file')
		node.removeAttribute('data-astro-source-line')
	})

	return {
		html: root.toString(),
		entries,
		components,
	}
}

/**
 * Extract component name from source file path
 * e.g., "src/components/Welcome.astro" -> "Welcome"
 * e.g., "src/components/ui/Button.astro" -> "Button"
 */
function extractComponentName(sourceFile: string): string {
	const parts = sourceFile.split('/')
	const fileName = parts[parts.length - 1] || ''
	return fileName.replace('.astro', '')
}

/**
 * Clean text for comparison (normalize whitespace)
 */
export function cleanText(text: string): string {
	return text.trim().replace(/\s+/g, ' ').toLowerCase()
}
