import { parse as parseAstro } from '@astrojs/compiler'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

export interface AstroTransformOptions {
	markComponents?: boolean
}

/**
 * Vite plugin that transforms .astro files to inject source location metadata
 * This runs during Astro's compilation phase and adds data-astro-source-file and
 * data-astro-source-line attributes to HTML elements in the template.
 *
 * NOTE: Component marking is NOT done here because modifying component tags
 * in the raw .astro source breaks Astro's JSX-like parser. Component marking
 * is done at the HTML output level instead (in dev-middleware and build-processor).
 */
export function createAstroTransformPlugin(options: AstroTransformOptions = {}): Plugin {
	// Component marking is intentionally disabled at the transform level
	// const { markComponents = true } = options;

	return {
		name: 'astro-cms-source-injector',
		enforce: 'pre', // Run before Astro's own transforms

		async transform(code: string, id: string) {
			if (!id.endsWith('.astro')) {
				return null
			}

			if (id.includes('node_modules')) {
				return null
			}

			try {
				const rawCode = await fs.readFile(id, 'utf-8')
				const relativePath = path.relative(process.cwd(), id)
				const result = await parseAstro(rawCode, { position: true })

				if (!result.ast) {
					return null
				}

				const transformed = injectSourceAttributes(rawCode, result.ast, relativePath)

				if (transformed !== rawCode) {
					return {
						code: transformed,
						map: null,
					}
				}

				return null
			} catch (error) {
				console.warn(`[astro-cms-marker] Failed to transform ${id}:`, error)
				return null
			}
		},
	}
}

/**
 * Inject source location attributes into HTML elements
 * NOTE: Component marking is NOT done here - it breaks Astro's parser
 */
function injectSourceAttributes(code: string, ast: any, filePath: string): string {
	const lines = code.split('\n')
	const modifications: Array<{ line: number; column: number; insertion: string }> = []

	// Find the template section (after frontmatter)
	let inFrontmatter = false
	let frontmatterEnd = -1

	for (let i = 0; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') {
			if (!inFrontmatter) {
				inFrontmatter = true
			} else {
				frontmatterEnd = i
				break
			}
		}
	}

	// If no frontmatter, start from line 0 (all lines are template)
	if (frontmatterEnd === -1) {
		frontmatterEnd = -1 // Will make check start.line > 0
	}

	// Walk the AST and collect modifications
	const collectElements = (node: any, depth: number = 0) => {
		if (!node) {
			return
		}

		// Only process regular HTML elements, NOT components
		if (node.type === 'element' && node.position) {
			const { start } = node.position
			const tagName = node.name?.toLowerCase()

			// Only process elements in template section (after frontmatter or from start if no frontmatter)
			const templateStartLine = frontmatterEnd === -1 ? 0 : frontmatterEnd + 1
			if (start.line > templateStartLine) {
				// Skip certain elements
				if (['html', 'head', 'body', 'script', 'style', 'slot', 'fragment'].includes(tagName)) {
					// Still process children
					if (node.children && Array.isArray(node.children)) {
						for (const child of node.children) {
							collectElements(child, depth + 1)
						}
					}
					return
				}

				// Find where to insert the attribute (after tag name, before other attributes or >)
				const lineIndex = start.line - 1
				if (lineIndex < 0 || lineIndex >= lines.length) {
					return
				}

				const line = lines[lineIndex]
				const tagStartCol = start.column - 1

				// Find the position after the tag name
				const tagMatch = line?.slice(tagStartCol).match(/^<(\w+)/)
				if (!tagMatch) {
					return
				}

				const insertCol = tagStartCol + tagMatch[0].length
				const sourceAttr = ` data-astro-source-file="${filePath}" data-astro-source-line="${start.line}"`

				modifications.push({
					line: lineIndex,
					column: insertCol,
					insertion: sourceAttr,
				})
			}
		}

		// Recursively process children
		if (node.children && Array.isArray(node.children)) {
			for (const child of node.children) {
				collectElements(child, depth + 1)
			}
		}
	}

	// Start walking from root children
	if (ast.children && Array.isArray(ast.children)) {
		for (const child of ast.children) {
			collectElements(child, 0)
		}
	}

	// Sort modifications by position (reverse order so we can apply them without recalculating positions)
	modifications.sort((a, b) => {
		if (a.line !== b.line) {
			return b.line - a.line
		}
		return b.column - a.column
	})

	// Apply modifications
	const modifiedLines = [...lines]
	for (const mod of modifications) {
		const line = modifiedLines[mod.line]

		// Validate line exists - if not, there's a bug in AST positions or bounds checking
		if (line === undefined) {
			console.error(
				`[astro-cms-marker] Invalid modification at line ${mod.line + 1} in ${filePath}. ` +
				`This indicates a bug in @astrojs/compiler AST positions or bounds checking. Skipping modification.`
			)
			continue
		}

		// Validate column is within line bounds
		if (mod.column < 0 || mod.column > line.length) {
			console.error(
				`[astro-cms-marker] Invalid column ${mod.column} at line ${mod.line + 1} in ${filePath}. ` +
				`Line length is ${line.length}. Skipping modification.`
			)
			continue
		}

		// Apply the modification safely
		modifiedLines[mod.line] = line.slice(0, mod.column) + mod.insertion + line.slice(mod.column)
	}

	return modifiedLines.join('\n')
}
