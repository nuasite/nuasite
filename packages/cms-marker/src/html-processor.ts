import { parse } from 'node-html-parser'
import { enhanceManifestWithSourceSnippets } from './source-finder'
import { extractColorClasses } from './tailwind-colors'
import type { ComponentInstance, ManifestEntry, SourceContext } from './types'
import { generateStableId } from './utils'

/**
 * Inline text styling elements that should NOT be marked with CMS IDs.
 * These elements are text formatting and should be part of their parent's content.
 * They will be preserved as HTML when editing the parent element.
 */
export const INLINE_STYLE_TAGS = [
	'strong',
	'b',
	'em',
	'i',
	'u',
	's',
	'strike',
	'del',
	'ins',
	'mark',
	'small',
	'sub',
	'sup',
	'abbr',
	'cite',
	'code',
	'kbd',
	'samp',
	'var',
	'time',
	'dfn',
	'q',
] as const

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
	/** When true, only mark elements that have source file attributes (from Astro templates) */
	skipMarkdownContent?: boolean
	/**
	 * When true, skip marking inline text styling elements (strong, b, em, i, etc.).
	 * These elements will be preserved as part of their parent's HTML content.
	 * Defaults to true.
	 */
	skipInlineStyleTags?: boolean
	/** Collection info for marking the wrapper element containing markdown content */
	collectionInfo?: {
		name: string
		slug: string
		/** First line of the markdown body (used to find wrapper element in build mode) */
		bodyFirstLine?: string
		/** Path to the markdown file (e.g., 'src/content/blog/my-post.md') */
		contentPath?: string
	}
}

export interface ProcessHtmlResult {
	html: string
	entries: Record<string, ManifestEntry>
	components: Record<string, ComponentInstance>
	/** ID of the element wrapping collection markdown content */
	collectionWrapperId?: string
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
		skipMarkdownContent = false,
		skipInlineStyleTags = true,
		collectionInfo,
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
	let collectionWrapperId: string | undefined

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
			// Support both our custom attribute and Astro's native attribute
			const sourceLocAttr = node.getAttribute('data-astro-source-loc')
				|| node.getAttribute('data-astro-source-line')
				|| '1:0'
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

	// Image detection pass: mark img elements for CMS image replacement
	// Store image entries separately to add to manifest later
	const imageEntries = new Map<string, { src: string; alt: string }>()
	root.querySelectorAll('img').forEach((node) => {
		// Skip if already marked
		if (node.getAttribute(attributeName)) return

		const src = node.getAttribute('src')
		if (!src) return // Skip images without src

		const id = getNextId()
		node.setAttribute(attributeName, id)
		node.setAttribute('data-cms-img', 'true')

		// Store image info for manifest
		imageEntries.set(id, {
			src,
			alt: node.getAttribute('alt') || '',
		})
	})

	// Collection wrapper detection pass: find the element that wraps markdown content
	// Two strategies:
	// 1. Dev mode: look for elements with data-astro-source-file containing children without it
	// 2. Build mode: find element whose first child content matches the start of markdown body
	if (collectionInfo) {
		const allElements = root.querySelectorAll('*')
		let foundWrapper = false

		// Strategy 1: Dev mode - look for source file attributes
		for (const node of allElements) {
			const sourceFile = node.getAttribute('data-astro-source-file')
			if (!sourceFile) continue

			// Check if this element has any direct child elements without source file attribute
			// These would be markdown-rendered elements
			const childElements = node.childNodes.filter(
				(child: any) => child.nodeType === 1 && child.tagName,
			)
			const hasMarkdownChildren = childElements.some(
				(child: any) => !child.getAttribute?.('data-astro-source-file'),
			)

			if (hasMarkdownChildren) {
				// Check if any ancestor already has been marked as a collection wrapper
				// We want the innermost wrapper
				let parent = node.parentNode
				let hasAncestorWrapper = false
				while (parent) {
					if ((parent as any).getAttribute?.(attributeName)?.startsWith('cms-collection-')) {
						hasAncestorWrapper = true
						break
					}
					parent = parent.parentNode
				}

				if (!hasAncestorWrapper) {
					// Mark this as the collection wrapper using the standard attribute
					const id = getNextId()
					node.setAttribute(attributeName, id)
					node.setAttribute('data-cms-markdown', 'true')
					collectionWrapperId = id
					foundWrapper = true
					// Don't break - we want the deepest wrapper, so we'll overwrite
				}
			}
		}

		// Strategy 2: Build mode - find element by matching markdown body content
		if (!foundWrapper && collectionInfo.bodyFirstLine) {
			// Normalize the first line of markdown body for comparison
			// Strip markdown syntax to compare with rendered HTML text
			const bodyStart = collectionInfo.bodyFirstLine
				.replace(/^\*\*|\*\*$/g, '') // Remove markdown bold markers at start/end
				.replace(/\*\*/g, '') // Remove any remaining markdown bold markers
				.replace(/\*/g, '') // Remove markdown italic markers
				.replace(/^#+ /, '') // Remove heading markers
				.replace(/^\s*[-*+]\s+/, '') // Remove list markers
				.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Extract link text
				.trim()
				.substring(0, 50) // Take first 50 chars for matching

			if (bodyStart.length > 10) {
				// Store all candidates that match the body start
				const candidates: Array<{ node: any; blockChildCount: number }> = []

				for (const node of allElements) {
					const tag = node.tagName?.toLowerCase?.() ?? ''
					// Skip script, style, etc.
					if (['script', 'style', 'head', 'meta', 'link'].includes(tag)) continue

					// Check if this element's first text content starts with the markdown body
					const firstChild = node.childNodes.find(
						(child: any) => child.nodeType === 1 && child.tagName,
					) as any

					if (firstChild) {
						const firstChildText = (firstChild.innerText || '').trim().substring(0, 80)
						if (firstChildText.includes(bodyStart)) {
							// Count block-level child elements
							// Markdown typically renders to multiple block elements (p, h2, h3, ul, ol, etc.)
							const blockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre', 'table', 'hr']
							const blockChildCount = node.childNodes.filter(
								(child: any) => child.nodeType === 1 && blockTags.includes(child.tagName?.toLowerCase?.()),
							).length

							candidates.push({ node, blockChildCount })
						}
					}
				}

				// Pick the candidate with the most block children (likely the markdown wrapper)
				// Filter out already-marked elements
				const unmarkedCandidates = candidates.filter(c => !c.node.getAttribute(attributeName))
				if (unmarkedCandidates.length > 0) {
					const best = unmarkedCandidates.reduce((a, b) => (b.blockChildCount > a.blockChildCount ? b : a))
					if (best.blockChildCount >= 2) {
						// Markdown body should have at least 2 block children
						const id = getNextId()
						best.node.setAttribute(attributeName, id)
						best.node.setAttribute('data-cms-markdown', 'true')
						collectionWrapperId = id
						foundWrapper = true
					}
				}
			}
		}
	}

	// Third pass: assign IDs to all qualifying text elements and extract source locations
	root.querySelectorAll('*').forEach((node) => {
		const tag = node.tagName?.toLowerCase?.() ?? ''

		if (excludeTags.includes(tag)) return
		if (includeTags && !includeTags.includes(tag)) return
		if (node.getAttribute(attributeName)) return // Already marked

		// Skip inline text styling elements (strong, b, em, i, etc.)
		// These should be part of their parent's text content, not separately editable
		// Only apply when includeTags is null (all tags) - if specific tags are listed, respect them
		if (skipInlineStyleTags && includeTags === null && INLINE_STYLE_TAGS.includes(tag as typeof INLINE_STYLE_TAGS[number])) {
			return
		}

		// Skip styled spans (spans with only text styling Tailwind classes)
		// These are also inline text formatting and should be part of parent content
		// Only apply when includeTags is null or doesn't include 'span'
		if (skipInlineStyleTags && (includeTags === null || !includeTags.includes('span')) && tag === 'span') {
			const classAttr = node.getAttribute('class')
			if (classAttr && hasOnlyTextStyleClasses(classAttr)) {
				return
			}
		}

		const textContent = (node.innerText ?? '').trim()
		if (!includeEmptyText && !textContent) return

		// Extract source location from Astro compiler attributes
		// Support both Astro's native attribute (data-astro-source-loc) and our custom one (data-astro-source-line)
		const sourceFile = node.getAttribute('data-astro-source-file')
		const sourceLine = node.getAttribute('data-astro-source-loc')
			|| node.getAttribute('data-astro-source-line')

		// When skipMarkdownContent is true, only mark elements that have source file attributes
		// (meaning they come from Astro templates, not rendered markdown content)
		if (skipMarkdownContent && !sourceFile) {
			return
		}

		const id = getNextId()
		node.setAttribute(attributeName, id)

		if (sourceFile && sourceLine) {
			const lineNum = parseInt(sourceLine.split(':')[0] ?? '1', 10)
			if (!Number.isNaN(lineNum)) {
				sourceLocationMap.set(id, { file: sourceFile, line: lineNum })
			}
			// Only remove source attributes if this is NOT a component root
			// Component roots need these for identification
			if (!markedComponentRoots.has(node)) {
				node.removeAttribute('data-astro-source-file')
				node.removeAttribute('data-astro-source-loc')
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

			// Check if this is the collection wrapper
			const isCollectionWrapper = id === collectionWrapperId

			// Skip pure container elements (no direct text, only child CMS elements)
			// BUT always include the collection wrapper
			if (!directText && childCmsIds.length > 0 && !isCollectionWrapper) {
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

			// Extract source context for resilient matching
			const sourceContext = extractSourceContext(node, attributeName)

			// Check if element contains inline style elements (strong, b, em, etc.) or styled spans
			// If so, store the HTML content for source file updates
			const inlineStyleSelector = INLINE_STYLE_TAGS.join(', ')
			const hasInlineStyleElements = node.querySelector(inlineStyleSelector) !== null
			const hasStyledSpans = node.querySelector('[data-cms-styled]') !== null
			const htmlContent = (hasInlineStyleElements || hasStyledSpans) ? node.innerHTML : undefined

			// Check if this is an image entry
			const imageInfo = imageEntries.get(id)
			const isImage = !!imageInfo

			const entryText = isImage ? (imageInfo.alt || imageInfo.src) : textWithPlaceholders.trim()
			const entrySourcePath = sourceLocation?.file || sourcePath

			// Generate stable ID based on content and context
			const stableId = generateStableId(tag, entryText, entrySourcePath, sourceContext)

			// Extract color classes for buttons and other elements
			const classAttr = node.getAttribute('class')
			const colorClasses = extractColorClasses(classAttr)

			entries[id] = {
				id,
				tag,
				text: entryText,
				html: htmlContent,
				sourcePath: entrySourcePath,
				childCmsIds: childCmsIds.length > 0 ? childCmsIds : undefined,
				sourceLine: sourceLocation?.line,
				sourceSnippet: undefined,
				sourceType: isImage ? 'image' : (isCollectionWrapper ? 'collection' : undefined),
				variableName: undefined,
				parentComponentId,
				// Add collection info for the wrapper entry
				collectionName: isCollectionWrapper ? collectionInfo?.name : undefined,
				collectionSlug: isCollectionWrapper ? collectionInfo?.slug : undefined,
				contentPath: isCollectionWrapper ? collectionInfo?.contentPath : undefined,
				// Add image info for image entries
				imageSrc: imageInfo?.src,
				imageAlt: imageInfo?.alt,
				// Robustness fields
				stableId,
				sourceContext,
				// Color classes for buttons/styled elements
				colorClasses,
			}
		})
	}

	// Clean up any remaining source attributes from component-marked elements
	markedComponentRoots.forEach((node: any) => {
		node.removeAttribute('data-astro-source-file')
		node.removeAttribute('data-astro-source-loc')
		node.removeAttribute('data-astro-source-line')
	})

	// Enhance manifest entries with actual source snippets from source files
	// This allows the CMS to match and replace dynamic content in source files
	const enhancedEntries = await enhanceManifestWithSourceSnippets(entries)

	return {
		html: root.toString(),
		entries: enhancedEntries,
		components,
		collectionWrapperId,
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

/**
 * Extract source context for an element to enable resilient matching.
 * This captures information about the element's position in the DOM
 * that can be used as fallback when exact matching fails.
 */
function extractSourceContext(node: any, attributeName: string): SourceContext | undefined {
	const parent = node.parentNode
	if (!parent) return undefined

	const siblings = parent.childNodes?.filter((child: any) => {
		// Only consider element nodes, not text nodes
		return child.nodeType === 1 && child.tagName
	}) || []

	const siblingIndex = siblings.indexOf(node)

	// Get preceding sibling's text (first 30 chars)
	let precedingText: string | undefined
	if (siblingIndex > 0) {
		const prevSibling = siblings[siblingIndex - 1]
		const prevText = (prevSibling?.innerText || '').trim()
		if (prevText) {
			precedingText = prevText.substring(0, 30)
		}
	}

	// Get following sibling's text (first 30 chars)
	let followingText: string | undefined
	if (siblingIndex < siblings.length - 1) {
		const nextSibling = siblings[siblingIndex + 1]
		const nextText = (nextSibling?.innerText || '').trim()
		if (nextText) {
			followingText = nextText.substring(0, 30)
		}
	}

	// Get parent info
	const parentTag = parent.tagName?.toLowerCase?.()
	const parentClasses = parent.getAttribute?.('class') || undefined

	// Only return context if we have meaningful data
	if (!precedingText && !followingText && !parentTag) {
		return undefined
	}

	return {
		precedingText,
		followingText,
		parentTag,
		siblingIndex: siblingIndex >= 0 ? siblingIndex : undefined,
		parentClasses,
	}
}
