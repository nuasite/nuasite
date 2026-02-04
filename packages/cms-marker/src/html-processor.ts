import { type HTMLElement as ParsedHTMLElement, parse } from 'node-html-parser'
import { processSeoFromHtml } from './seo-processor'
import { enhanceManifestWithSourceSnippets } from './source-finder'
import { extractColorClasses } from './tailwind-colors'
import type { Attribute, ComponentInstance, ImageMetadata, ManifestEntry, PageSeoData, SeoOptions } from './types'
import { generateStableId } from './utils'

/** Type for parsed HTML element nodes from node-html-parser */
type HTMLNode = ParsedHTMLElement

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
		/** Full markdown body text (used for robust wrapper detection in build mode) */
		bodyText?: string
		/** Path to the markdown file (e.g., 'src/content/blog/my-post.md') */
		contentPath?: string
	}
	/** SEO tracking options */
	seo?: SeoOptions
}

export interface ProcessHtmlResult {
	html: string
	entries: Record<string, ManifestEntry>
	components: Record<string, ComponentInstance>
	/** ID of the element wrapping collection markdown content */
	collectionWrapperId?: string
	/** Extracted SEO data from the page */
	seo?: PageSeoData
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
 * Get text content from an HTML node, treating <br> elements as whitespace.
 * This matches the rendered HTML behavior where <br> creates line breaks.
 */
function getTextContent(node: HTMLNode): string {
	const result: string[] = []

	for (const child of node.childNodes) {
		if (child.nodeType === 3) {
			// Text node
			result.push(child.text || '')
		} else if (child.nodeType === 1) {
			// Element node
			const tagName = (child as HTMLNode).tagName?.toLowerCase?.()
			if (tagName === 'br') {
				// Treat <br> as whitespace
				result.push(' ')
			} else if (tagName === 'wbr') {
				// Word break opportunity - no visible content
			} else {
				// Recursively get text from child elements
				result.push(getTextContent(child as HTMLNode))
			}
		}
	}

	return result.join('')
}

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
		seo: seoOptions,
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
	const markedComponentRoots = new Set<HTMLNode>()
	let collectionWrapperId: string | undefined
	const componentCountPerParent = new Map<string, Map<string, number>>()

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
			let parent = node.parentNode as HTMLNode | null
			let ancestorFromSameComponent = false
			while (parent) {
				const parentSource = parent.getAttribute?.('data-astro-source-file')
				if (parentSource === sourceFile) {
					ancestorFromSameComponent = true
					break
				}
				parent = parent.parentNode as HTMLNode | null
			}

			if (ancestorFromSameComponent) return

			// Find the nearest ancestor with a different source file (the parent that invokes this component)
			let invocationSourcePath: string | undefined
			let ancestor = node.parentNode as HTMLNode | null
			while (ancestor) {
				const ancestorSource = ancestor.getAttribute?.('data-astro-source-file')
				if (ancestorSource && ancestorSource !== sourceFile) {
					invocationSourcePath = ancestorSource
					break
				}
				ancestor = ancestor.parentNode as HTMLNode | null
			}

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

			// Track invocation index (0-based count of same component name per parent file)
			let invocationIndex: number | undefined
			if (invocationSourcePath) {
				if (!componentCountPerParent.has(invocationSourcePath)) {
					componentCountPerParent.set(invocationSourcePath, new Map())
				}
				const counters = componentCountPerParent.get(invocationSourcePath)!
				const current = counters.get(componentName) ?? 0
				counters.set(componentName, current + 1)
				invocationIndex = current
			}

			components[id] = {
				id,
				componentName,
				file: fileId,
				sourcePath: sourceFile,
				sourceLine,
				props: {}, // Props will be filled from component definitions
				invocationSourcePath,
				invocationIndex,
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

	// Collection wrapper detection pass: find the element that wraps markdown content
	// This needs to run BEFORE image marking so we can skip images inside markdown
	let markdownWrapperNode: HTMLNode | null = null

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
				(child): child is HTMLNode => child.nodeType === 1 && 'tagName' in child,
			)
			const hasMarkdownChildren = childElements.some(
				(child) => !child.getAttribute?.('data-astro-source-file'),
			)

			if (hasMarkdownChildren) {
				// Check if any ancestor already has been marked as a collection wrapper
				// We want the innermost wrapper
				let parent = node.parentNode as HTMLNode | null
				let hasAncestorWrapper = false
				while (parent) {
					if (parent.getAttribute?.(attributeName)?.startsWith('cms-collection-')) {
						hasAncestorWrapper = true
						break
					}
					parent = parent.parentNode as HTMLNode | null
				}

				if (!hasAncestorWrapper) {
					// Mark this as the collection wrapper using the standard attribute
					const id = getNextId()
					node.setAttribute(attributeName, id)
					node.setAttribute('data-cms-markdown', 'true')
					collectionWrapperId = id
					markdownWrapperNode = node
					foundWrapper = true
					// Don't break - we want the deepest wrapper, so we'll overwrite
				}
			}
		}

		// Strategy 2: Build mode - find the deepest element containing all markdown body text
		if (!foundWrapper && collectionInfo.bodyText) {
			// Strip markdown syntax to get plain text for comparison
			const bodyPlain = collectionInfo.bodyText
				.replace(/^---[\s\S]*?---\n*/m, '') // Remove frontmatter
				.replace(/!\[[^\]]*\]\([^)]+\)/g, '') // Remove images
				.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1') // Extract link text
				.replace(/^#+\s+/gm, '') // Remove heading markers
				.replace(/^\s*[-*+]\s+/gm, '') // Remove list markers
				.replace(/^\s*\d+\.\s+/gm, '') // Remove ordered list markers
				.replace(/^\s*>\s+/gm, '') // Remove blockquote markers
				.replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, '')) // Remove code backticks
				.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1') // Remove bold/italic markers
				.replace(/~{2}([^~]+)~{2}/g, '$1') // Remove strikethrough markers
				.replace(/\n{2,}/g, '\n') // Collapse multiple newlines
				.trim()

			// Extract a few unique text snippets from different parts of the body
			const lines = bodyPlain.split('\n').map(l => l.trim()).filter(l => l.length > 3)
			const snippets: string[] = []
			if (lines.length > 0) snippets.push(lines[0]!.substring(0, 60))
			if (lines.length > 1) snippets.push(lines[lines.length - 1]!.substring(0, 60))
			if (lines.length > 2) snippets.push(lines[Math.floor(lines.length / 2)]!.substring(0, 60))

			if (snippets.length > 0) {
				// Find the deepest element that contains all snippets
				let bestWrapper: HTMLNode | null = null
				let bestDepth = -1

				const measureDepth = (node: HTMLNode): number => {
					let depth = 0
					let current = node.parentNode as HTMLNode | null
					while (current) {
						depth++
						current = current.parentNode as HTMLNode | null
					}
					return depth
				}

				for (const node of allElements) {
					const tag = node.tagName?.toLowerCase?.() ?? ''
					if (['script', 'style', 'head', 'meta', 'link', 'html'].includes(tag)) continue
					// Skip already-marked elements
					if (node.getAttribute(attributeName)) continue

					const nodeText = getTextContent(node).trim()
					const containsAll = snippets.every(s => nodeText.includes(s))
					if (containsAll) {
						const depth = measureDepth(node)
						if (depth > bestDepth) {
							bestDepth = depth
							bestWrapper = node
						}
					}
				}

				if (bestWrapper) {
					const id = getNextId()
					bestWrapper.setAttribute(attributeName, id)
					bestWrapper.setAttribute('data-cms-markdown', 'true')
					collectionWrapperId = id
					markdownWrapperNode = bestWrapper
					foundWrapper = true
				}
			}
		}

		// Strategy 3: Legacy fallback - match first line only (for when bodyText is not available)
		if (!foundWrapper && collectionInfo.bodyFirstLine) {
			const bodyStart = collectionInfo.bodyFirstLine
				.replace(/^\*\*|\*\*$/g, '')
				.replace(/\*\*/g, '')
				.replace(/\*/g, '')
				.replace(/^#+ /, '')
				.replace(/^\s*[-*+]\s+/, '')
				.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
				.trim()
				.substring(0, 50)

			if (bodyStart.length > 3) {
				const candidates: Array<{ node: HTMLNode; blockChildCount: number }> = []

				for (const node of allElements) {
					const tag = node.tagName?.toLowerCase?.() ?? ''
					if (['script', 'style', 'head', 'meta', 'link'].includes(tag)) continue

					const firstChild = node.childNodes.find(
						(child): child is HTMLNode => child.nodeType === 1 && 'tagName' in child,
					)

					if (firstChild) {
						const firstChildText = getTextContent(firstChild).trim().substring(0, 80)
						if (firstChildText.includes(bodyStart)) {
							const blockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre', 'table', 'hr']
							const blockChildCount = node.childNodes.filter(
								(child): child is HTMLNode =>
									child.nodeType === 1 && 'tagName' in child && blockTags.includes((child as HTMLNode).tagName?.toLowerCase?.() ?? ''),
							).length

							candidates.push({ node, blockChildCount })
						}
					}
				}

				const unmarkedCandidates = candidates.filter(c => !c.node.getAttribute(attributeName))
				if (unmarkedCandidates.length > 0) {
					const best = unmarkedCandidates.reduce((a, b) => (b.blockChildCount > a.blockChildCount ? b : a))
					if (best.blockChildCount >= 1) {
						const id = getNextId()
						best.node.setAttribute(attributeName, id)
						best.node.setAttribute('data-cms-markdown', 'true')
						collectionWrapperId = id
						markdownWrapperNode = best.node
						foundWrapper = true
					}
				}
			}
		}
	}

	// Helper function to check if a node is inside the markdown wrapper
	const isInsideMarkdownWrapper = (node: HTMLNode): boolean => {
		if (!markdownWrapperNode) return false
		let current = node.parentNode as HTMLNode | null
		while (current) {
			if (current === markdownWrapperNode) return true
			current = current.parentNode as HTMLNode | null
		}
		return false
	}

	// Image detection pass: mark img elements for CMS image replacement
	// Store image entries separately to add to manifest later
	// NOTE: Skip images inside markdown wrapper - they are edited via the markdown editor
	interface ImageEntry {
		metadata: ImageMetadata
		sourceFile?: string
		sourceLine?: number
	}
	const imageEntries = new Map<string, ImageEntry>()
	root.querySelectorAll('img').forEach((node) => {
		// Skip if already marked
		if (node.getAttribute(attributeName)) return

		// Skip images inside markdown wrapper - they are edited via the markdown editor
		if (isInsideMarkdownWrapper(node)) return

		const src = node.getAttribute('src')
		if (!src) return // Skip images without src

		// When skipMarkdownContent is true (collection pages), only mark images
		// that have source file attributes (from Astro templates, not markdown)
		if (skipMarkdownContent) {
			// Check if the image or any ancestor has source file attribute
			let hasSourceAttr = false
			let current: HTMLNode | null = node
			while (current) {
				if (current.getAttribute?.('data-astro-source-file')) {
					hasSourceAttr = true
					break
				}
				current = current.parentNode as HTMLNode | null
			}
			if (!hasSourceAttr) return
		}

		const id = getNextId()
		node.setAttribute(attributeName, id)
		node.setAttribute('data-cms-img', 'true')

		// Try to get source location from the image itself or ancestors
		let sourceFile: string | undefined
		let sourceLine: number | undefined
		let current: HTMLNode | null = node
		while (current && !sourceFile) {
			const file = current.getAttribute?.('data-astro-source-file')
			const line = current.getAttribute?.('data-astro-source-loc') || current.getAttribute?.('data-astro-source-line')
			if (file) {
				sourceFile = file
				if (line) {
					const lineNum = parseInt(line.split(':')[0] ?? '1', 10)
					if (!Number.isNaN(lineNum)) {
						sourceLine = lineNum
					}
				}
			}
			current = current.parentNode as HTMLNode | null
		}

		// Build image metadata
		const metadata: ImageMetadata = {
			src,
			alt: node.getAttribute('alt') || '',
			srcSet: node.getAttribute('srcset') || undefined,
			sizes: node.getAttribute('sizes') || undefined,
		}

		// Store image info for manifest
		imageEntries.set(id, {
			metadata,
			sourceFile,
			sourceLine,
		})
	})

	// Third pass: collect candidate text elements (don't mark yet)
	// We collect candidates first to filter out pure containers before marking
	interface TextCandidate {
		node: HTMLNode
		tag: string
		sourceFile: string | undefined
		sourceLine: string | undefined
	}
	const textCandidates: TextCandidate[] = []
	const candidateNodes = new Set<HTMLNode>()

	root.querySelectorAll('*').forEach((node) => {
		const tag = node.tagName?.toLowerCase?.() ?? ''

		if (excludeTags.includes(tag)) return
		if (includeTags && !includeTags.includes(tag)) return
		if (node.getAttribute(attributeName)) return // Already marked (images, collection wrapper)

		// Skip elements inside markdown wrapper - they are edited via the markdown editor
		if (isInsideMarkdownWrapper(node)) return

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

		const textContent = getTextContent(node).trim()
		if (!includeEmptyText && !textContent) return

		// Extract source location from Astro compiler attributes
		const sourceFile = node.getAttribute('data-astro-source-file')
		const sourceLine = node.getAttribute('data-astro-source-loc')
			|| node.getAttribute('data-astro-source-line')

		// When skipMarkdownContent is true, only mark elements that have source file attributes
		// (meaning they come from Astro templates, not rendered markdown content)
		if (skipMarkdownContent && !sourceFile) {
			return
		}

		textCandidates.push({ node, tag, sourceFile: sourceFile || undefined, sourceLine: sourceLine || undefined })
		candidateNodes.add(node)
	})

	// Helper to check if a node has direct text (text not inside candidate descendants)
	const hasDirectText = (node: HTMLNode): boolean => {
		// Check for text nodes directly under this element (not inside candidate children)
		for (const child of node.childNodes) {
			if (child.nodeType === 3) {
				// Text node
				const text = (child.text || '').trim()
				if (text) return true
			} else if (child.nodeType === 1) {
				// Element node - only recurse if it's not a candidate
				const childEl = child as HTMLNode
				if (!candidateNodes.has(childEl) && !childEl.getAttribute?.(attributeName)) {
					if (hasDirectText(childEl)) return true
				}
			}
		}
		return false
	}

	// Helper to check if a node has any candidate or already-marked descendants
	const hasCandidateDescendants = (node: HTMLNode): boolean => {
		for (const child of node.childNodes) {
			if (child.nodeType === 1) {
				const childEl = child as HTMLNode
				if (candidateNodes.has(childEl) || childEl.getAttribute?.(attributeName)) {
					return true
				}
				if (hasCandidateDescendants(childEl)) return true
			}
		}
		return false
	}

	// Filter out pure containers (no direct text, only candidate/marked children)
	// and mark remaining candidates
	for (const candidate of textCandidates) {
		const { node, sourceFile, sourceLine } = candidate

		// Check if this is a pure container (no direct text, only has candidate descendants)
		const directText = hasDirectText(node)
		const hasDescendants = hasCandidateDescendants(node)

		// Skip pure containers - they have no direct text and all content comes from children
		if (!directText && hasDescendants) {
			candidateNodes.delete(node) // Remove from candidates so nested checks stay accurate
			continue
		}

		// Mark this element
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
	}

	// Fourth pass: build manifest entries for all marked elements
	if (generateManifest) {
		root.querySelectorAll(`[${attributeName}]`).forEach((node) => {
			const id = node.getAttribute(attributeName)
			if (!id) return

			const tag = node.tagName?.toLowerCase?.() ?? ''

			// Get child CMS elements
			const childCmsElements = node.querySelectorAll(`[${attributeName}]`)
			const childCmsIds = Array.from(childCmsElements)
				.map((child) => child.getAttribute(attributeName))
				.filter((id): id is string => id !== null)

			// Build text with placeholders for child CMS elements
			// Recursively process child nodes to handle nested CMS elements correctly
			type ChildNode = { nodeType: number; text?: string; tagName?: string; childNodes?: ChildNode[]; getAttribute?: (name: string) => string | null }
			const buildTextWithPlaceholders = (nodes: ChildNode[]): string => {
				let text = ''
				for (const child of nodes) {
					if (child.nodeType === 3) {
						// Text node
						text += child.text || ''
					} else if (child.nodeType === 1) {
						// Element node
						const tagName = child.tagName?.toLowerCase?.()

						// Preserve <br> and <wbr> literally so text matches source snippets
						if (tagName === 'br') {
							text += '<br>'
							continue
						}
						if (tagName === 'wbr') {
							text += '<wbr>'
							continue
						}

						const directCmsId = child.getAttribute?.(attributeName)

						if (directCmsId) {
							// Child has a direct CMS ID - use placeholder
							text += `{{cms:${directCmsId}}}`
						} else {
							// Child doesn't have a CMS ID - recursively process its children
							text += buildTextWithPlaceholders((child.childNodes || []) as ChildNode[])
						}
					}
				}
				return text
			}

			const textWithPlaceholders = buildTextWithPlaceholders((node.childNodes || []) as ChildNode[])

			// Get source location from map (injected by Astro compiler)
			const sourceLocation = sourceLocationMap.get(id)

			// Find parent component if any
			let parentComponentId: string | undefined
			let parent = node.parentNode as HTMLNode | null
			while (parent) {
				const parentCompId = parent.getAttribute?.('data-cms-component-id')
				if (parentCompId) {
					parentComponentId = parentCompId
					break
				}
				parent = parent.parentNode as HTMLNode | null
			}

			// Check if element contains inline style elements (strong, b, em, etc.) or styled spans
			// If so, store the HTML content for source file updates
			const inlineStyleSelector = INLINE_STYLE_TAGS.join(', ')
			const hasInlineStyleElements = node.querySelector(inlineStyleSelector) !== null
			const hasStyledSpans = node.querySelector('[data-cms-styled]') !== null
			const htmlContent = (hasInlineStyleElements || hasStyledSpans) ? node.innerHTML : undefined

			// Check if this is an image entry
			const imageInfo = imageEntries.get(id)
			const isImage = !!imageInfo

			// Check if this is the collection wrapper
			const isCollectionWrapper = id === collectionWrapperId

			const entryText = isImage ? (imageInfo.metadata.alt || imageInfo.metadata.src) : textWithPlaceholders.trim()
			// For images, use the source file we captured from ancestors if not in sourceLocationMap
			const entrySourcePath = sourceLocation?.file || imageInfo?.sourceFile || sourcePath

			// Generate stable ID based on content and context
			const stableId = generateStableId(tag, entryText, entrySourcePath)

			// Extract color classes for buttons and other elements
			const classAttr = node.getAttribute('class')
			const colorClasses = extractColorClasses(classAttr)

			// Extract all relevant attributes for git diff tracking
			const attributes = extractAllAttributes(node)

			entries[id] = {
				id,
				tag,
				text: entryText,
				html: htmlContent,
				sourcePath: entrySourcePath,
				childCmsIds: childCmsIds.length > 0 ? childCmsIds : undefined,
				sourceLine: sourceLocation?.line ?? imageInfo?.sourceLine,
				sourceSnippet: undefined,
				variableName: undefined,
				parentComponentId,
				// Add collection info for the wrapper entry
				collectionName: isCollectionWrapper ? collectionInfo?.name : undefined,
				collectionSlug: isCollectionWrapper ? collectionInfo?.slug : undefined,
				contentPath: isCollectionWrapper ? collectionInfo?.contentPath : undefined,
				// Robustness fields
				stableId,
				// Image metadata for image entries
				imageMetadata: imageInfo?.metadata,
				// Color classes for buttons/styled elements
				colorClasses,
				// All attributes with resolved values (isStatic will be updated later from source)
				attributes,
			}
		})
	}

	// Clean up any remaining source attributes from component-marked elements
	markedComponentRoots.forEach((node) => {
		node.removeAttribute('data-astro-source-file')
		node.removeAttribute('data-astro-source-loc')
		node.removeAttribute('data-astro-source-line')
	})

	// Enhance manifest entries with actual source snippets from source files
	// This allows the CMS to match and replace dynamic content in source files
	const enhancedEntries = await enhanceManifestWithSourceSnippets(entries)

	// Get the current HTML for SEO processing
	let finalHtml = root.toString()

	// Process SEO elements from the page
	let seo: PageSeoData | undefined
	if (seoOptions?.trackSeo !== false) {
		const seoResult = await processSeoFromHtml(
			finalHtml,
			{
				markTitle: seoOptions?.markTitle ?? true,
				parseJsonLd: seoOptions?.parseJsonLd ?? true,
				sourcePath,
			},
			getNextId,
		)

		seo = seoResult.seo
		finalHtml = seoResult.html

		// If title was marked with CMS ID, add it to entries
		if (seoResult.titleId && seo.title) {
			enhancedEntries[seoResult.titleId] = {
				id: seoResult.titleId,
				tag: 'title',
				text: seo.title.content,
				sourcePath: seo.title.sourcePath || sourcePath,
				sourceLine: seo.title.sourceLine,
				sourceSnippet: seo.title.sourceSnippet,
			}
		}
	}

	return {
		html: finalHtml,
		entries: enhancedEntries,
		components,
		collectionWrapperId,
		seo,
	}
}

/**
 * Extract component name from source file path
 * e.g., "src/components/Welcome.astro" -> "Welcome"
 * e.g., "src/components/ui/Button.astro" -> "Button"
 */
export function extractComponentName(sourceFile: string): string {
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
 * Extract all relevant attributes from an element for git diff tracking.
 * Returns a Record mapping attribute names to Attribute objects.
 * Initially all attributes are marked as isStatic: true - this will be
 * updated later when we analyze the source code.
 */
function extractAllAttributes(node: HTMLNode): Record<string, Attribute> | undefined {
	const tag = node.tagName?.toLowerCase?.()
	const result: Record<string, Attribute> = {}

	// Helper to add an attribute if it has a value
	const addAttr = (name: string, value: string | boolean | null | undefined) => {
		if (value !== null && value !== undefined && value !== '') {
			result[name] = {
				value: typeof value === 'boolean' ? String(value) : value,
			}
		}
	}

	// Common attributes for all elements
	addAttr('id', node.getAttribute('id'))
	addAttr('title', node.getAttribute('title'))
	addAttr('lang', node.getAttribute('lang'))
	addAttr('tabindex', node.getAttribute('tabindex'))

	// Link attributes (a tags)
	if (tag === 'a') {
		addAttr('href', node.getAttribute('href'))
		addAttr('target', node.getAttribute('target'))
		addAttr('rel', node.getAttribute('rel'))
		if (node.hasAttribute('download')) {
			addAttr('download', node.getAttribute('download') || 'true')
		}
	}

	// Button attributes
	if (tag === 'button') {
		addAttr('type', node.getAttribute('type'))
		addAttr('form', node.getAttribute('form'))
		addAttr('formaction', node.getAttribute('formaction'))
		addAttr('formmethod', node.getAttribute('formmethod'))
		if (node.hasAttribute('disabled')) addAttr('disabled', 'true')
	}

	// Input attributes
	if (tag === 'input') {
		addAttr('type', node.getAttribute('type'))
		addAttr('name', node.getAttribute('name'))
		addAttr('placeholder', node.getAttribute('placeholder'))
		addAttr('value', node.getAttribute('value'))
		addAttr('pattern', node.getAttribute('pattern'))
		addAttr('inputmode', node.getAttribute('inputmode'))
		addAttr('autocomplete', node.getAttribute('autocomplete'))
		addAttr('min', node.getAttribute('min'))
		addAttr('max', node.getAttribute('max'))
		addAttr('step', node.getAttribute('step'))
		addAttr('minlength', node.getAttribute('minlength'))
		addAttr('maxlength', node.getAttribute('maxlength'))
		if (node.hasAttribute('required')) addAttr('required', 'true')
		if (node.hasAttribute('disabled')) addAttr('disabled', 'true')
		if (node.hasAttribute('readonly')) addAttr('readonly', 'true')
	}

	// Form attributes
	if (tag === 'form') {
		addAttr('action', node.getAttribute('action'))
		addAttr('method', node.getAttribute('method'))
		addAttr('enctype', node.getAttribute('enctype'))
		addAttr('target', node.getAttribute('target'))
		addAttr('name', node.getAttribute('name'))
		if (node.hasAttribute('novalidate')) addAttr('novalidate', 'true')
	}

	// Media attributes (video, audio)
	if (tag === 'video' || tag === 'audio') {
		addAttr('src', node.getAttribute('src'))
		addAttr('poster', node.getAttribute('poster'))
		addAttr('preload', node.getAttribute('preload'))
		if (node.hasAttribute('controls')) addAttr('controls', 'true')
		if (node.hasAttribute('autoplay')) addAttr('autoplay', 'true')
		if (node.hasAttribute('muted')) addAttr('muted', 'true')
		if (node.hasAttribute('loop')) addAttr('loop', 'true')
		if (node.hasAttribute('playsinline')) addAttr('playsinline', 'true')
	}

	// Iframe attributes
	if (tag === 'iframe') {
		addAttr('src', node.getAttribute('src'))
		addAttr('allow', node.getAttribute('allow'))
		addAttr('sandbox', node.getAttribute('sandbox'))
		addAttr('loading', node.getAttribute('loading'))
		addAttr('width', node.getAttribute('width'))
		addAttr('height', node.getAttribute('height'))
		addAttr('name', node.getAttribute('name'))
	}

	// Select attributes
	if (tag === 'select') {
		addAttr('name', node.getAttribute('name'))
		addAttr('size', node.getAttribute('size'))
		if (node.hasAttribute('multiple')) addAttr('multiple', 'true')
		if (node.hasAttribute('required')) addAttr('required', 'true')
		if (node.hasAttribute('disabled')) addAttr('disabled', 'true')
	}

	// Textarea attributes
	if (tag === 'textarea') {
		addAttr('name', node.getAttribute('name'))
		addAttr('placeholder', node.getAttribute('placeholder'))
		addAttr('rows', node.getAttribute('rows'))
		addAttr('cols', node.getAttribute('cols'))
		addAttr('minlength', node.getAttribute('minlength'))
		addAttr('maxlength', node.getAttribute('maxlength'))
		addAttr('wrap', node.getAttribute('wrap'))
		if (node.hasAttribute('required')) addAttr('required', 'true')
		if (node.hasAttribute('disabled')) addAttr('disabled', 'true')
		if (node.hasAttribute('readonly')) addAttr('readonly', 'true')
	}

	// Image attributes
	if (tag === 'img') {
		addAttr('src', node.getAttribute('src'))
		addAttr('alt', node.getAttribute('alt'))
		addAttr('width', node.getAttribute('width'))
		addAttr('height', node.getAttribute('height'))
		addAttr('loading', node.getAttribute('loading'))
		addAttr('decoding', node.getAttribute('decoding'))
	}

	// ARIA attributes (for any element)
	addAttr('role', node.getAttribute('role'))
	addAttr('aria-label', node.getAttribute('aria-label'))
	addAttr('aria-labelledby', node.getAttribute('aria-labelledby'))
	addAttr('aria-describedby', node.getAttribute('aria-describedby'))
	addAttr('aria-controls', node.getAttribute('aria-controls'))
	addAttr('aria-owns', node.getAttribute('aria-owns'))
	addAttr('aria-current', node.getAttribute('aria-current'))
	addAttr('aria-live', node.getAttribute('aria-live'))
	if (node.hasAttribute('aria-hidden')) addAttr('aria-hidden', node.getAttribute('aria-hidden') || 'true')
	if (node.hasAttribute('aria-expanded')) addAttr('aria-expanded', node.getAttribute('aria-expanded') || 'true')
	if (node.hasAttribute('aria-pressed')) addAttr('aria-pressed', node.getAttribute('aria-pressed') || 'true')
	if (node.hasAttribute('aria-selected')) addAttr('aria-selected', node.getAttribute('aria-selected') || 'true')
	if (node.hasAttribute('aria-disabled')) addAttr('aria-disabled', node.getAttribute('aria-disabled') || 'true')
	if (node.hasAttribute('aria-required')) addAttr('aria-required', node.getAttribute('aria-required') || 'true')
	if (node.hasAttribute('aria-invalid')) addAttr('aria-invalid', node.getAttribute('aria-invalid') || 'true')
	if (node.hasAttribute('aria-atomic')) addAttr('aria-atomic', node.getAttribute('aria-atomic') || 'true')
	if (node.hasAttribute('aria-busy')) addAttr('aria-busy', node.getAttribute('aria-busy') || 'true')
	if (node.hasAttribute('aria-haspopup')) addAttr('aria-haspopup', node.getAttribute('aria-haspopup') || 'true')

	// Custom data-* attributes (selective - common patterns)
	const rawAttributes = node.rawAttrs || ''
	const dataAttrMatches = rawAttributes.matchAll(/data-([\w-]+)="([^"]*)"/g)
	for (const match of dataAttrMatches) {
		const attrName = `data-${match[1]}`
		// Skip internal CMS attributes
		if (!attrName.startsWith('data-cms') && !attrName.startsWith('data-astro')) {
			addAttr(attrName, match[2])
		}
	}

	return Object.keys(result).length > 0 ? result : undefined
}
