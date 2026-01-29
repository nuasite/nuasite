import type { BabelNode, LineTransformer, VariableDefinition } from './types'

// ============================================================================
// String Value Extraction
// ============================================================================

/**
 * Extract string value from a Babel node (StringLiteral or simple TemplateLiteral)
 */
export function getStringValue(node: BabelNode): string | null {
	if (node.type === 'StringLiteral') {
		return node.value as string
	}
	if (node.type === 'TemplateLiteral') {
		const quasis = node.quasis as Array<{ value: { cooked: string | null } }> | undefined
		const expressions = node.expressions as unknown[] | undefined
		if (quasis?.length === 1 && expressions?.length === 0) {
			return quasis[0]?.value.cooked ?? null
		}
	}
	return null
}

// ============================================================================
// Object and Array Extraction
// ============================================================================

/**
 * Extract property name from an object key node.
 * Handles both `{ name: value }` (Identifier) and `{ "name": value }` (StringLiteral).
 */
function getKeyName(key: BabelNode): string | null {
	if (key.type === 'Identifier') return key.name as string
	if (key.type === 'StringLiteral') return key.value as string
	return null
}

/**
 * Recursively extract properties from an object expression
 * @param objNode - The ObjectExpression node
 * @param parentPath - The full path to this object (e.g., 'config' or 'config.nav')
 * @param definitions - Array to collect definitions into
 * @param lineTransformer - Transforms Babel line numbers to file line numbers
 */
export function extractObjectProperties(
	objNode: BabelNode,
	parentPath: string,
	definitions: VariableDefinition[],
	lineTransformer: LineTransformer,
): void {
	const properties = objNode.properties as BabelNode[] | undefined
	for (const prop of properties ?? []) {
		if (prop.type !== 'ObjectProperty') continue
		const key = prop.key as BabelNode | undefined
		const value = prop.value as BabelNode | undefined
		if (!key || !value) continue
		const propName = getKeyName(key)
		if (!propName) continue
		const fullPath = `${parentPath}.${propName}`
		const propLoc = prop.loc as { start: { line: number } } | undefined
		const propLine = lineTransformer(propLoc?.start.line ?? 1)

		const stringValue = getStringValue(value)
		if (stringValue !== null) {
			definitions.push({
				name: propName,
				value: stringValue,
				line: propLine,
				parentName: parentPath,
			})
		}

		// Recurse for nested objects
		if (value.type === 'ObjectExpression') {
			extractObjectProperties(value, fullPath, definitions, lineTransformer)
		}

		// Handle arrays within objects
		if (value.type === 'ArrayExpression') {
			extractArrayElements(value, fullPath, definitions, lineTransformer, propLine)
		}
	}
}

/**
 * Extract elements from an array expression
 * @param arrNode - The ArrayExpression node
 * @param parentPath - The full path to this array (e.g., 'items' or 'config.items')
 * @param definitions - Array to collect definitions into
 * @param lineTransformer - Transforms Babel line numbers to file line numbers
 * @param defaultLine - Fallback line if element has no location
 */
export function extractArrayElements(
	arrNode: BabelNode,
	parentPath: string,
	definitions: VariableDefinition[],
	lineTransformer: LineTransformer,
	defaultLine: number,
): void {
	const elements = arrNode.elements as BabelNode[] | undefined
	for (let i = 0; i < (elements?.length ?? 0); i++) {
		const elem = elements![i]
		if (!elem) continue

		const elemLoc = elem.loc as { start: { line: number } } | undefined
		const elemLine = elemLoc ? lineTransformer(elemLoc.start.line) : defaultLine
		const indexPath = `${parentPath}[${i}]`

		// Handle string values in array
		const elemValue = getStringValue(elem)
		if (elemValue !== null) {
			definitions.push({
				name: String(i),
				value: elemValue,
				line: elemLine,
				parentName: parentPath,
			})
		}

		// Handle array of objects: [{ text: 'Home' }] or [{ "text": 'Home' }]
		if (elem.type === 'ObjectExpression') {
			const objProperties = elem.properties as BabelNode[] | undefined
			for (const prop of objProperties ?? []) {
				if (prop.type !== 'ObjectProperty') continue
				const key = prop.key as BabelNode | undefined
				const value = prop.value as BabelNode | undefined
				if (!key || !value) continue
				const propName = getKeyName(key)
				if (!propName) continue
				const propLoc = prop.loc as { start: { line: number } } | undefined
				const propLine = propLoc ? lineTransformer(propLoc.start.line) : elemLine

				const stringValue = getStringValue(value)
				if (stringValue !== null) {
					definitions.push({
						name: propName,
						value: stringValue,
						line: propLine,
						parentName: indexPath,
					})
				}

				// Recurse for nested objects within array elements
				if (value.type === 'ObjectExpression') {
					extractObjectProperties(value, `${indexPath}.${propName}`, definitions, lineTransformer)
				}
			}
		}
	}
}

// ============================================================================
// Path Building Utilities
// ============================================================================

/**
 * Build the full path for a variable definition.
 * For array indices (numeric names), uses bracket notation: items[0]
 * For object properties, uses dot notation: config.nav.title
 */
export function buildDefinitionPath(def: VariableDefinition): string {
	if (!def.parentName) {
		return def.name
	}
	// Check if the name is a numeric index (for arrays)
	if (/^\d+$/.test(def.name)) {
		return `${def.parentName}[${def.name}]`
	}
	return `${def.parentName}.${def.name}`
}

/**
 * Parse an expression path and extract the full path for variable lookup.
 * Handles patterns like: varName, obj.prop, items[0], config.nav.title, links[0].text
 * @returns The full expression path or null if not a simple variable reference
 */
export function parseExpressionPath(exprText: string): string | null {
	// Match patterns like: varName, obj.prop, items[0], config.nav.title, links[0].text
	// Pattern breakdown: word characters, dots, and bracket notation with numbers
	const match = exprText.match(/^\s*([\w]+(?:\.[\w]+|\[\d+\])*(?:\.[\w]+)?)\s*$/)
	if (match) {
		return match[1]!
	}
	return null
}
