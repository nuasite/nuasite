import type { ComponentNode, ElementNode, Node as AstroNode, TextNode } from '@astrojs/compiler/types'

import { buildDefinitionPath, parseExpressionPath } from './ast-extractors'
import { normalizeText } from './snippet-utils'
import type {
	ComponentPropMatch,
	ExpressionPropMatch,
	FindElementResult,
	ImportInfo,
	SpreadPropMatch,
	TemplateMatch,
	VariableDefinition,
} from './types'

// ============================================================================
// Text Content Extraction
// ============================================================================

/**
 * Get text content from an AST node recursively.
 * Treats <br> elements as whitespace to match rendered HTML behavior.
 */
export function getTextContent(node: AstroNode): string {
	if (node.type === 'text') {
		return (node as TextNode).value
	}
	// Treat <br> elements as whitespace (they create line breaks in rendered HTML)
	if (node.type === 'element' && (node as ElementNode).name.toLowerCase() === 'br') {
		return ' '
	}
	// Treat <wbr> elements as empty (word break opportunity, no visible content)
	if (node.type === 'element' && (node as ElementNode).name.toLowerCase() === 'wbr') {
		return ''
	}
	if ('children' in node && Array.isArray(node.children)) {
		return node.children.map(getTextContent).join('')
	}
	return ''
}

/**
 * Check for expression children and extract variable names
 */
export function hasExpressionChild(node: AstroNode): { found: boolean; varNames: string[] } {
	const varNames: string[] = []
	if (node.type === 'expression') {
		// Try to extract variable name from expression
		// The expression node children contain the text representation
		const exprText = getTextContent(node)
		// Extract variable paths like {foo}, {foo.bar}, {items[0]}, {config.nav.title}, {links[0].text}
		const fullPath = parseExpressionPath(exprText)
		if (fullPath) {
			varNames.push(fullPath)
		}
		return { found: true, varNames }
	}
	if ('children' in node && Array.isArray(node.children)) {
		for (const child of node.children) {
			const result = hasExpressionChild(child)
			if (result.found) {
				varNames.push(...result.varNames)
			}
		}
	}
	return { found: varNames.length > 0, varNames }
}

// ============================================================================
// Element Finding
// ============================================================================

/**
 * Walk the Astro AST to find elements matching a tag with specific text content.
 * Returns the best match (local variables or static content) AND all prop/import candidates
 * that need cross-file verification for multiple same-tag elements.
 * @param propAliases - Map of local variable names to prop names from Astro.props (for cross-file tracking)
 * @param imports - Import information from frontmatter (for cross-file tracking)
 */
export function findElementWithText(
	ast: AstroNode,
	tag: string,
	searchText: string,
	variableDefinitions: VariableDefinition[],
	propAliases: Map<string, string> = new Map(),
	imports: ImportInfo[] = [],
): FindElementResult {
	const normalizedSearch = normalizeText(searchText)
	const tagLower = tag.toLowerCase()
	let bestMatch: TemplateMatch | null = null
	let bestScore = 0
	const propCandidates: TemplateMatch[] = []
	const importCandidates: TemplateMatch[] = []

	/**
	 * Extract the base variable name from an expression path.
	 * e.g., 'items[0]' -> 'items', 'config.nav.title' -> 'config'
	 */
	function getBaseVarName(exprPath: string): string {
		const match = exprPath.match(/^(\w+)/)
		return match?.[1] ?? exprPath
	}

	function visit(node: AstroNode) {
		// Check if this is an element or component matching our tag
		if ((node.type === 'element' || node.type === 'component') && node.name.toLowerCase() === tagLower) {
			const elemNode = node as ElementNode | ComponentNode
			const textContent = getTextContent(elemNode)
			const normalizedContent = normalizeText(textContent)
			const line = elemNode.position?.start.line ?? 0

			// Check for expression (variable reference)
			const exprInfo = hasExpressionChild(elemNode)
			if (exprInfo.found && exprInfo.varNames.length > 0) {
				// Look for matching variable definition
				for (const exprPath of exprInfo.varNames) {
					let foundInLocal = false

					for (const def of variableDefinitions) {
						// Build the full definition path for comparison
						const defPath = buildDefinitionPath(def)
						// Check if the expression path matches the definition path
						if (defPath === exprPath) {
							foundInLocal = true
							const normalizedDef = normalizeText(def.value)
							if (normalizedDef === normalizedSearch) {
								// Found a variable match - this is highest priority
								if (bestScore < 100) {
									bestScore = 100
									bestMatch = {
										line,
										type: 'variable',
										variableName: defPath,
										definitionLine: def.line,
									}
								}
								return
							}
						}
					}

					// If not found in local definitions, check if it's from props or imports
					if (!foundInLocal) {
						const baseVar = getBaseVarName(exprPath)

						// Check props first
						const actualPropName = propAliases.get(baseVar)
						if (actualPropName) {
							// This expression uses a prop - collect as candidate for cross-file verification
							// (don't set bestMatch yet - we need to verify each candidate)
							propCandidates.push({
								line,
								type: 'variable',
								usesProp: true,
								propName: actualPropName, // Use the actual prop name, not the local alias
								expressionPath: exprPath,
							})
						} else {
							// Check if it's from an import
							const importInfo = imports.find((imp) => imp.localName === baseVar)
							if (importInfo) {
								// This expression uses an import - collect as candidate for cross-file verification
								importCandidates.push({
									line,
									type: 'variable',
									usesImport: true,
									importInfo,
									expressionPath: exprPath,
								})
							}
						}
					}
				}
			}

			// Check for direct text match (static content)
			// Only match if there's meaningful text content (not just variable names/expressions)
			if (normalizedContent && normalizedContent.length >= 2 && normalizedSearch.length > 0) {
				// For short search text (<= 10 chars), require exact match
				if (normalizedSearch.length <= 10) {
					if (normalizedContent.includes(normalizedSearch)) {
						const score = 80
						if (score > bestScore) {
							bestScore = score
							const actualLine = findTextLine(elemNode, normalizedSearch)
							bestMatch = {
								line: actualLine ?? line,
								type: 'static',
							}
						}
					}
				} // For longer search text, check if content contains a significant portion
				else if (normalizedSearch.length > 10) {
					const textPreview = normalizedSearch.slice(0, Math.min(30, normalizedSearch.length))
					if (normalizedContent.includes(textPreview)) {
						const matchLength = Math.min(normalizedSearch.length, normalizedContent.length)
						const score = 50 + (matchLength / normalizedSearch.length) * 40
						if (score > bestScore) {
							bestScore = score
							const actualLine = findTextLine(elemNode, textPreview)
							bestMatch = {
								line: actualLine ?? line,
								type: 'static',
							}
						}
					} // Try matching first few words for very long text
					else if (normalizedSearch.length > 20) {
						const firstWords = normalizedSearch.split(' ').slice(0, 3).join(' ')
						if (firstWords && normalizedContent.includes(firstWords)) {
							const score = 40
							if (score > bestScore) {
								bestScore = score
								const actualLine = findTextLine(elemNode, firstWords)
								bestMatch = {
									line: actualLine ?? line,
									type: 'static',
								}
							}
						}
					}
				}
			}
		}

		// Recursively visit children
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child)
			}
		}
	}

	function findTextLine(node: AstroNode, searchText: string): number | null {
		if (node.type === 'text') {
			const textNode = node as TextNode
			if (normalizeText(textNode.value).includes(searchText)) {
				return textNode.position?.start.line ?? null
			}
		}
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				const line = findTextLine(child, searchText)
				if (line !== null) return line
			}
		}
		return null
	}

	visit(ast)
	return { bestMatch, propCandidates, importCandidates }
}

// ============================================================================
// Component Prop Finding
// ============================================================================

/**
 * Walk the Astro AST to find component props with specific text value
 */
export function findComponentProp(
	ast: AstroNode,
	searchText: string,
): ComponentPropMatch | null {
	const normalizedSearch = normalizeText(searchText)

	function visit(node: AstroNode): ComponentPropMatch | null {
		// Check component nodes (PascalCase names)
		if (node.type === 'component') {
			const compNode = node as ComponentNode
			for (const attr of compNode.attributes) {
				if (attr.type === 'attribute' && attr.kind === 'quoted') {
					const normalizedValue = normalizeText(attr.value)
					if (normalizedValue === normalizedSearch) {
						return {
							line: attr.position?.start.line ?? compNode.position?.start.line ?? 0,
							propName: attr.name,
							propValue: attr.value,
						}
					}
				}
			}
		}

		// Recursively visit children
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				const result = visit(child)
				if (result) return result
			}
		}

		return null
	}

	return visit(ast)
}

/**
 * Walk the Astro AST to find component usages with expression props.
 * Looks for patterns like: <Nav items={navItems} />
 * @param ast - The Astro AST
 * @param componentName - The component name to search for (e.g., 'Nav')
 * @param propName - The prop name to find (e.g., 'items')
 */
export function findExpressionProp(
	ast: AstroNode,
	componentName: string,
	propName: string,
): ExpressionPropMatch | null {
	function visit(node: AstroNode): ExpressionPropMatch | null {
		// Check component nodes matching the name
		if (node.type === 'component') {
			const compNode = node as ComponentNode
			if (compNode.name === componentName) {
				for (const attr of compNode.attributes) {
					// Check for expression attributes: items={navItems}
					if (attr.type === 'attribute' && attr.name === propName && attr.kind === 'expression') {
						// The value contains the expression text
						const exprText = attr.value?.trim() || ''
						if (exprText) {
							return {
								componentName,
								propName,
								expressionText: exprText,
								line: attr.position?.start.line ?? compNode.position?.start.line ?? 0,
							}
						}
					}
				}
			}
		}

		// Recursively visit children
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				const result = visit(child)
				if (result) return result
			}
		}

		return null
	}

	return visit(ast)
}

/**
 * Walk the Astro AST to find component usages with spread props.
 * Looks for patterns like: <Card {...cardProps} />
 * @param ast - The Astro AST
 * @param componentName - The component name to search for (e.g., 'Card')
 */
export function findSpreadProp(
	ast: AstroNode,
	componentName: string,
): SpreadPropMatch | null {
	function visit(node: AstroNode, parentExpression: AstroNode | null): SpreadPropMatch | null {
		// Check component nodes matching the name
		if (node.type === 'component') {
			const compNode = node as ComponentNode
			if (compNode.name === componentName) {
				for (const attr of compNode.attributes) {
					// Check for spread attributes: {...cardProps}
					// In Astro AST: type='attribute', kind='spread', name=variable name
					if (attr.type === 'attribute' && attr.kind === 'spread' && attr.name) {
						const match: SpreadPropMatch = {
							componentName,
							spreadVarName: attr.name,
							line: attr.position?.start.line ?? compNode.position?.start.line ?? 0,
						}

						// Check if this spread is inside a .map() call by examining parent expression
						if (parentExpression) {
							const exprText = getTextContent(parentExpression)
							const mapMatch = exprText.match(/(\w+(?:\.\w+)*)\.map\s*\(\s*\(?(\w+)\)?\s*=>/)
							if (mapMatch && mapMatch[2] === attr.name) {
								match.mapSourceArray = mapMatch[1]
							}
						}

						return match
					}
				}
			}
		}

		// Track the nearest ancestor expression node
		const nextParentExpression = node.type === 'expression' ? node : parentExpression

		// Recursively visit children
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				const result = visit(child, nextParentExpression)
				if (result) return result
			}
		}

		return null
	}

	return visit(ast, null)
}
