import { parse as parseBabel } from '@babel/parser'
import fs from 'node:fs/promises'
import path from 'node:path'

import { extractArrayElements, extractObjectProperties, getStringValue } from './ast-extractors'
import type { BabelFile, BabelNode, ImportInfo, VariableDefinition } from './types'
import { createFrontmatterLineTransformer, identityLine } from './types'

// ============================================================================
// Variable Definition Extraction
// ============================================================================

/**
 * Extract variable definitions from Babel AST
 * Finds const/let/var declarations with string literal values
 *
 * Note: Babel parses the frontmatter content (without --- delimiters) starting at line 1.
 * frontmatterStartLine is the actual file line where the content begins (after first ---).
 * So we convert: file_line = (babel_line - 1) + frontmatterStartLine
 */
export function extractVariableDefinitions(ast: BabelFile, frontmatterStartLine: number): VariableDefinition[] {
	const definitions: VariableDefinition[] = []
	const lineTransformer = createFrontmatterLineTransformer(frontmatterStartLine)

	function visitNode(node: BabelNode) {
		if (node.type === 'VariableDeclaration') {
			const declarations = node.declarations as BabelNode[] | undefined
			for (const decl of declarations ?? []) {
				const id = decl.id as BabelNode | undefined
				const init = decl.init as BabelNode | undefined
				if (id?.type === 'Identifier' && init) {
					const varName = id.name as string
					const loc = decl.loc as { start: { line: number } } | undefined
					const line = lineTransformer(loc?.start.line ?? 1)

					// Simple string value
					const stringValue = getStringValue(init)
					if (stringValue !== null) {
						definitions.push({ name: varName, value: stringValue, line })
					}

					// Object expression - extract properties recursively
					if (init.type === 'ObjectExpression') {
						extractObjectProperties(init, varName, definitions, lineTransformer)
					}

					// Array expression - extract elements
					if (init.type === 'ArrayExpression') {
						extractArrayElements(init, varName, definitions, lineTransformer, line)
					}
				}

				// Handle ObjectPattern (destructuring from Astro.props with default values)
				// Pattern: const { title = ['a', 'b'] } = Astro.props
				if (id?.type === 'ObjectPattern' && init?.type === 'MemberExpression') {
					const object = init.object as BabelNode | undefined
					const property = init.property as BabelNode | undefined

					// Only process Astro.props destructuring
					if (
						object?.type === 'Identifier'
						&& (object.name as string) === 'Astro'
						&& property?.type === 'Identifier'
						&& (property.name as string) === 'props'
					) {
						const properties = id.properties as BabelNode[] | undefined
						for (const prop of properties ?? []) {
							if (prop.type === 'ObjectProperty') {
								const value = prop.value as BabelNode | undefined

								// Handle default values: { title = [...] } or { heading: title = [...] }
								if (value?.type === 'AssignmentPattern') {
									const left = value.left as BabelNode | undefined
									const right = value.right as BabelNode | undefined

									// The local variable name is from `left` (e.g., 'title' in both cases)
									if (left?.type === 'Identifier' && right) {
										const localVarName = left.name as string
										const loc = right.loc as { start: { line: number } } | undefined
										const line = lineTransformer(loc?.start.line ?? 1)

										// Extract the default value
										const stringValue = getStringValue(right)
										if (stringValue !== null) {
											definitions.push({ name: localVarName, value: stringValue, line })
										}

										// Object expression default value
										if (right.type === 'ObjectExpression') {
											extractObjectProperties(right, localVarName, definitions, lineTransformer)
										}

										// Array expression default value
										if (right.type === 'ArrayExpression') {
											extractArrayElements(right, localVarName, definitions, lineTransformer, line)
										}
									}
								}
							}
						}
					}
				}
			}
		}

		// Recursively visit child nodes
		for (const key of Object.keys(node)) {
			const value = node[key]
			if (value && typeof value === 'object') {
				if (Array.isArray(value)) {
					for (const item of value) {
						if (item && typeof item === 'object' && 'type' in item) {
							visitNode(item as BabelNode)
						}
					}
				} else if ('type' in value) {
					visitNode(value as BabelNode)
				}
			}
		}
	}

	visitNode(ast.program)
	return definitions
}

// ============================================================================
// Prop Alias Extraction
// ============================================================================

/**
 * Extract prop aliases from Astro.props destructuring patterns.
 * Returns a Map of local variable name -> prop name.
 * Examples:
 *   const { title } = Astro.props         -> Map { 'title' => 'title' }
 *   const { items: navItems } = Astro.props -> Map { 'navItems' => 'items' }
 */
export function extractPropAliases(ast: BabelFile): Map<string, string> {
	const propAliases = new Map<string, string>()

	function visitNode(node: BabelNode) {
		if (node.type === 'VariableDeclaration') {
			const declarations = node.declarations as BabelNode[] | undefined
			for (const decl of declarations ?? []) {
				const id = decl.id as BabelNode | undefined
				const init = decl.init as BabelNode | undefined

				// Check for destructuring from Astro.props
				// Pattern: const { x, y } = Astro.props;
				if (id?.type === 'ObjectPattern' && init?.type === 'MemberExpression') {
					const object = init.object as BabelNode | undefined
					const property = init.property as BabelNode | undefined

					if (
						object?.type === 'Identifier'
						&& (object.name as string) === 'Astro'
						&& property?.type === 'Identifier'
						&& (property.name as string) === 'props'
					) {
						// Extract property names from the destructuring pattern
						const properties = id.properties as BabelNode[] | undefined
						for (const prop of properties ?? []) {
							if (prop.type === 'ObjectProperty') {
								const key = prop.key as BabelNode | undefined
								const value = prop.value as BabelNode | undefined

								if (key?.type === 'Identifier') {
									const propName = key.name as string
									// Check for renaming: { items: navItems }
									// key is the prop name (items), value is the local name (navItems)
									if (value?.type === 'Identifier') {
										const localName = value.name as string
										propAliases.set(localName, propName)
									} else if (value?.type === 'AssignmentPattern') {
										// Handle default values: { items: navItems = [] } or { items = [] }
										const left = value.left as BabelNode | undefined
										if (left?.type === 'Identifier') {
											propAliases.set(left.name as string, propName)
										}
									} else {
										// Simple case: { items } - key and value are the same
										propAliases.set(propName, propName)
									}
								}
							} else if (prop.type === 'RestElement') {
								// Handle rest pattern: const { x, ...rest } = Astro.props;
								const argument = prop.argument as BabelNode | undefined
								if (argument?.type === 'Identifier') {
									// Rest element captures all remaining props
									propAliases.set(argument.name as string, '...')
								}
							}
						}
					}
				}
			}
		}

		// Recursively visit child nodes
		for (const key of Object.keys(node)) {
			const value = node[key]
			if (value && typeof value === 'object') {
				if (Array.isArray(value)) {
					for (const item of value) {
						if (item && typeof item === 'object' && 'type' in item) {
							visitNode(item as BabelNode)
						}
					}
				} else if ('type' in value) {
					visitNode(value as BabelNode)
				}
			}
		}
	}

	visitNode(ast.program)
	return propAliases
}

// ============================================================================
// Import Extraction
// ============================================================================

/**
 * Extract import information from Babel AST.
 * Handles:
 *   import { foo } from './file'           -> { localName: 'foo', importedName: 'foo', source: './file' }
 *   import { foo as bar } from './file'    -> { localName: 'bar', importedName: 'foo', source: './file' }
 *   import foo from './file'               -> { localName: 'foo', importedName: 'default', source: './file' }
 *   import * as foo from './file'          -> { localName: 'foo', importedName: '*', source: './file' }
 */
export function extractImports(ast: BabelFile): ImportInfo[] {
	const imports: ImportInfo[] = []

	for (const node of ast.program.body) {
		if (node.type === 'ImportDeclaration') {
			const source = (node.source as BabelNode)?.value as string
			if (!source) continue

			const specifiers = node.specifiers as BabelNode[] | undefined
			for (const spec of specifiers ?? []) {
				if (spec.type === 'ImportSpecifier') {
					// Named import: import { foo } from './file' or import { foo as bar } from './file'
					const imported = spec.imported as BabelNode | undefined
					const local = spec.local as BabelNode | undefined
					if (imported?.type === 'Identifier' && local?.type === 'Identifier') {
						imports.push({
							localName: local.name as string,
							importedName: imported.name as string,
							source,
						})
					}
				} else if (spec.type === 'ImportDefaultSpecifier') {
					// Default import: import foo from './file'
					const local = spec.local as BabelNode | undefined
					if (local?.type === 'Identifier') {
						imports.push({
							localName: local.name as string,
							importedName: 'default',
							source,
						})
					}
				} else if (spec.type === 'ImportNamespaceSpecifier') {
					// Namespace import: import * as foo from './file'
					const local = spec.local as BabelNode | undefined
					if (local?.type === 'Identifier') {
						imports.push({
							localName: local.name as string,
							importedName: '*',
							source,
						})
					}
				}
			}
		}
	}

	return imports
}

// ============================================================================
// Import Resolution
// ============================================================================

/**
 * Resolve an import source path to an absolute file path.
 * Handles relative paths and tries common extensions.
 */
export async function resolveImportPath(source: string, fromFile: string): Promise<string | null> {
	// Only handle relative imports
	if (!source.startsWith('.')) {
		return null
	}

	const fromDir = path.dirname(fromFile)
	const basePath = path.resolve(fromDir, source)

	// Try different extensions
	const extensions = ['.ts', '.js', '.astro', '.tsx', '.jsx', '']
	for (const ext of extensions) {
		const fullPath = basePath + ext
		try {
			const stat = await fs.stat(fullPath)
			if (stat.isFile()) return fullPath
		} catch {
			// File doesn't exist with this extension
		}
	}

	// Try index files
	for (const ext of ['.ts', '.js', '.tsx', '.jsx']) {
		const indexPath = path.join(basePath, `index${ext}`)
		try {
			await fs.access(indexPath)
			return indexPath
		} catch {
			// File doesn't exist
		}
	}

	return null
}

// ============================================================================
// Export Extraction (for external files)
// ============================================================================

/**
 * Parse a TypeScript/JavaScript file and extract exported variable definitions.
 */
export async function getExportedDefinitions(filePath: string): Promise<VariableDefinition[]> {
	try {
		const content = await fs.readFile(filePath, 'utf-8')
		const ast = parseBabel(content, {
			sourceType: 'module',
			plugins: ['typescript'],
			errorRecovery: true,
		}) as unknown as BabelFile

		const definitions: VariableDefinition[] = []

		for (const node of ast.program.body) {
			// Handle: export const foo = 'value'
			if (node.type === 'ExportNamedDeclaration') {
				const declaration = node.declaration as BabelNode | undefined
				if (declaration?.type === 'VariableDeclaration') {
					const declarations = declaration.declarations as BabelNode[] | undefined
					for (const decl of declarations ?? []) {
						const id = decl.id as BabelNode | undefined
						const init = decl.init as BabelNode | undefined
						if (id?.type === 'Identifier' && init) {
							const varName = id.name as string
							const loc = decl.loc as { start: { line: number } } | undefined
							const line = loc?.start.line ?? 1

							const stringValue = getStringValue(init)
							if (stringValue !== null) {
								definitions.push({ name: varName, value: stringValue, line })
							}

							if (init.type === 'ObjectExpression') {
								extractObjectProperties(init, varName, definitions, identityLine)
							}

							if (init.type === 'ArrayExpression') {
								extractArrayElements(init, varName, definitions, identityLine, line)
							}
						}
					}
				}
			}

			// Handle: const foo = 'value'; export { foo }
			// First collect all variable declarations
			if (node.type === 'VariableDeclaration') {
				const declarations = node.declarations as BabelNode[] | undefined
				for (const decl of declarations ?? []) {
					const id = decl.id as BabelNode | undefined
					const init = decl.init as BabelNode | undefined
					if (id?.type === 'Identifier' && init) {
						const varName = id.name as string
						const loc = decl.loc as { start: { line: number } } | undefined
						const line = loc?.start.line ?? 1

						const stringValue = getStringValue(init)
						if (stringValue !== null) {
							definitions.push({ name: varName, value: stringValue, line })
						}

						if (init.type === 'ObjectExpression') {
							extractObjectProperties(init, varName, definitions, identityLine)
						}

						if (init.type === 'ArrayExpression') {
							extractArrayElements(init, varName, definitions, identityLine, line)
						}
					}
				}
			}
		}

		return definitions
	} catch {
		return []
	}
}
