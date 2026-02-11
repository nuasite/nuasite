import { parse as parseBabel } from '@babel/parser'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectRoot } from './config'
import { getErrorCollector } from './error-collector'
import type { ComponentDefinition, ComponentProp } from './types'

/**
 * Scans Astro component files and extracts their definitions including props
 */
export class ComponentRegistry {
	private components: Map<string, ComponentDefinition> = new Map()
	private componentDirs: string[]

	constructor(componentDirs: string[] = ['src/components']) {
		this.componentDirs = componentDirs
	}

	/**
	 * Scan all component directories and build the registry
	 */
	async scan(): Promise<void> {
		for (const dir of this.componentDirs) {
			const fullPath = path.join(getProjectRoot(), dir)
			try {
				await this.scanDirectory(fullPath, dir)
			} catch {
				// Directory doesn't exist, skip
			}
		}
	}

	/**
	 * Get all registered components
	 */
	getComponents(): Record<string, ComponentDefinition> {
		return Object.fromEntries(this.components)
	}

	/**
	 * Get a specific component by name
	 */
	getComponent(name: string): ComponentDefinition | undefined {
		return this.components.get(name)
	}

	/**
	 * Scan a directory recursively for .astro files
	 */
	private async scanDirectory(dir: string, relativePath: string): Promise<void> {
		const entries = await fs.readdir(dir, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)
			const relPath = path.join(relativePath, entry.name)

			if (entry.isDirectory()) {
				await this.scanDirectory(fullPath, relPath)
			} else if (entry.isFile() && entry.name.endsWith('.astro')) {
				await this.parseComponent(fullPath, relPath)
			}
		}
	}

	/**
	 * Parse a single Astro component file
	 */
	private async parseComponent(filePath: string, relativePath: string): Promise<void> {
		try {
			const content = await fs.readFile(filePath, 'utf-8')
			const componentName = path.basename(filePath, '.astro')

			const props = await this.extractProps(content)
			const slots = this.extractSlots(content)
			const description = this.extractDescription(content)
			const previewWidth = this.extractPreviewWidth(content)

			this.components.set(componentName, {
				name: componentName,
				file: relativePath,
				props,
				slots: slots.length > 0 ? slots : undefined,
				description,
				previewWidth,
			})
		} catch (error) {
			console.warn(`[ComponentRegistry] Failed to parse ${filePath}:`, error)
		}
	}

	/**
	 * Parse Props content using @babel/parser AST for correct TypeScript handling.
	 * Wraps the content in a synthetic interface and walks TSPropertySignature nodes.
	 */
	private parsePropsContent(propsContent: string): ComponentProp[] {
		const props: ComponentProp[] = []

		// Wrap in an interface so Babel can parse it as valid TypeScript
		const synthetic = `interface _Props {\n${propsContent}\n}`
		let ast: ReturnType<typeof parseBabel>
		try {
			ast = parseBabel(synthetic, {
				sourceType: 'module',
				plugins: ['typescript'],
				errorRecovery: true,
			})
		} catch {
			return props
		}

		const interfaceNode = ast.program.body[0]
		if (!interfaceNode || interfaceNode.type !== 'TSInterfaceDeclaration') return props

		// Collect leading comments per line for JSDoc / inline descriptions
		const lines = synthetic.split('\n')

		for (const member of interfaceNode.body.body) {
			if (member.type !== 'TSPropertySignature') continue
			if (member.key.type !== 'Identifier') continue

			const name = member.key.name
			const optional = !!member.optional

			// Reconstruct the type string from source text
			let type = 'unknown'
			if (member.typeAnnotation?.typeAnnotation) {
				const ta = member.typeAnnotation.typeAnnotation
				if (ta.loc) {
					// Extract the type text directly from the synthetic source
					const startLine = ta.loc.start.line - 1
					const endLine = ta.loc.end.line - 1
					if (startLine === endLine) {
						type = lines[startLine]!.slice(ta.loc.start.column, ta.loc.end.column).trim()
					} else {
						const parts: string[] = []
						for (let l = startLine; l <= endLine; l++) {
							if (l === startLine) parts.push(lines[l]!.slice(ta.loc.start.column))
							else if (l === endLine) parts.push(lines[l]!.slice(0, ta.loc.end.column))
							else parts.push(lines[l]!)
						}
						type = parts.join('\n').trim()
					}
				} else {
					type = this.typeAnnotationToString(ta)
				}
			}

			// Look for description from comments
			let description: string | undefined

			// First, check for inline trailing comment on the property's source line
			// (Babel can misattach these as leading comments of the next property)
			if (member.loc) {
				const lineIdx = member.loc.end.line - 1
				const sourceLine = lines[lineIdx]
				if (sourceLine) {
					const commentMatch = sourceLine.match(/\/\/\s*(.+?)\s*$/)
					if (commentMatch?.[1]) {
						description = commentMatch[1]
					}
				}
			}

			// If no inline comment, check for leading JSDoc or standalone line comments
			if (!description && member.leadingComments && member.leadingComments.length > 0) {
				const last = member.leadingComments[member.leadingComments.length - 1]!
				if (last.type === 'CommentBlock') {
					description = last.value
						.split('\n')
						.map((l: string) => l.replace(/^\s*\*\s?/, '').trim())
						.filter(Boolean)
						.join(' ')
				} else if (last.type === 'CommentLine' && last.loc && member.loc) {
					// Only use line comments on their own line (not inline on previous property)
					const commentLineContent = lines[last.loc.start.line - 1]?.trim()
					if (commentLineContent?.startsWith('//')) {
						description = last.value.trim()
					}
				}
			}

			if (name && type) {
				props.push({ name, type, required: !optional, description })
			}
		}

		return props
	}

	/**
	 * Fallback: convert a Babel TSType node to a human-readable string
	 */
	private typeAnnotationToString(node: any): string {
		switch (node.type) {
			case 'TSStringKeyword':
				return 'string'
			case 'TSNumberKeyword':
				return 'number'
			case 'TSBooleanKeyword':
				return 'boolean'
			case 'TSAnyKeyword':
				return 'any'
			case 'TSVoidKeyword':
				return 'void'
			case 'TSNullKeyword':
				return 'null'
			case 'TSUndefinedKeyword':
				return 'undefined'
			case 'TSUnknownKeyword':
				return 'unknown'
			case 'TSNeverKeyword':
				return 'never'
			case 'TSObjectKeyword':
				return 'object'
			case 'TSArrayType':
				return `${this.typeAnnotationToString(node.elementType)}[]`
			case 'TSUnionType':
				return node.types.map((t: any) => this.typeAnnotationToString(t)).join(' | ')
			case 'TSIntersectionType':
				return node.types.map((t: any) => this.typeAnnotationToString(t)).join(' & ')
			case 'TSLiteralType':
				if (node.literal.type === 'StringLiteral') return `'${node.literal.value}'`
				return String(node.literal.value)
			case 'TSTypeReference':
				if (node.typeName?.type === 'Identifier') return node.typeName.name
				return 'unknown'
			case 'TSParenthesizedType':
				return `(${this.typeAnnotationToString(node.typeAnnotation)})`
			default:
				return 'unknown'
		}
	}

	/**
	 * Extract content between balanced braces after a pattern match
	 * Properly handles nested objects
	 */
	private extractBalancedBraces(text: string, pattern: RegExp): string | null {
		const match = text.match(pattern)
		if (!match || match.index === undefined) return null

		// Find the opening brace position (right after the match)
		const startIndex = match.index + match[0].length
		let depth = 1 // We already have one opening brace
		let i = startIndex

		// Find the matching closing brace
		while (i < text.length && depth > 0) {
			if (text[i] === '{') {
				depth++
			} else if (text[i] === '}') {
				depth--
			}
			i++
		}

		if (depth !== 0) return null // Unbalanced braces

		// Extract content between braces (excluding the braces themselves)
		return text.substring(startIndex, i - 1)
	}

	/**
	 * Extract props from component frontmatter
	 */
	private async extractProps(content: string): Promise<ComponentProp[]> {
		const props: ComponentProp[] = []

		// Find the frontmatter section
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
		if (!frontmatterMatch?.[1]) return props

		const frontmatter = frontmatterMatch[1]

		// Look for Props interface
		const propsInterfaceContent = this.extractBalancedBraces(frontmatter, /interface\s+Props\s*\{/)
		if (propsInterfaceContent) {
			const extractedProps = this.parsePropsContent(propsInterfaceContent)
			props.push(...extractedProps)
		}

		// Look for type Props = { ... }
		if (props.length === 0) {
			const typePropsContent = this.extractBalancedBraces(frontmatter, /type\s+Props\s*=\s*\{/)
			if (typePropsContent) {
				const extractedProps = this.parsePropsContent(typePropsContent)
				props.push(...extractedProps)
			}
		}

		const destructureMatch = frontmatter?.match(/const\s*\{([^}]+)\}\s*=\s*Astro\.props/)
		if (destructureMatch) {
			const destructureContent = destructureMatch[1]

			const defaultMatches = destructureContent?.matchAll(/(\w+)\s*=\s*(['"`]?)([^'"`},]+)\2/g) ?? []
			for (const match of defaultMatches) {
				const propName = match[1]
				const defaultValue = match[3]
				const existingProp = props.find(p => p.name === propName)
				if (existingProp) {
					existingProp.defaultValue = defaultValue
				}
			}
		}

		return props
	}

	/**
	 * Extract slot names from template
	 */
	private extractSlots(content: string): string[] {
		const slots: string[] = []

		// Find <slot> elements with name attribute
		const slotMatches = content.matchAll(/<slot\s+name=["']([^"']+)["']/g)
		for (const match of slotMatches) {
			if (match[1]) {
				slots.push(match[1])
			}
		}

		// Check for default slot (unnamed slot) - match any <slot> tag without a name attribute
		const allSlotTags = content.matchAll(/<slot(?:\s+[^>]*)?\s*\/?>/g)
		for (const match of allSlotTags) {
			const tag = match[0]
			// Check if this slot tag doesn't have a name attribute
			if (!/name\s*=/.test(tag)) {
				if (!slots.includes('default')) {
					slots.unshift('default')
				}
				break // Only need to find one default slot
			}
		}

		return slots
	}

	/**
	 * Extract component description from JSDoc comment
	 */
	private extractDescription(content: string): string | undefined {
		// Look for JSDoc comment at the start of frontmatter
		const match = content.match(/^---\n\/\*\*\s*([\s\S]*?)\s*\*\//)
		if (match?.[1]) {
			return match[1]
				.split('\n')
				.map(line => line.replace(/^\s*\*\s?/, '').trim())
				.filter(Boolean)
				.join(' ')
		}
		return undefined
	}

	/**
	 * Extract @previewWidth value from JSDoc comment
	 */
	private extractPreviewWidth(content: string): number | undefined {
		const match = content.match(/^---\n\/\*\*\s*([\s\S]*?)\s*\*\//)
		if (match?.[1]) {
			const widthMatch = match[1].match(/@previewWidth\s+(\d+)/)
			if (widthMatch?.[1]) {
				return parseInt(widthMatch[1], 10)
			}
		}
		return undefined
	}
}

/**
 * Parse component usage in an Astro file to extract prop values
 */
export function parseComponentUsage(
	content: string,
	componentName: string,
): Array<{ line: number; props: Record<string, string> }> {
	const usages: Array<{ line: number; props: Record<string, string> }> = []
	const lines = content.split('\n')

	// Match component usage: <ComponentName prop="value" />
	const componentRegex = new RegExp(
		`<${componentName}\\s+([^>]*?)\\s*\\/?>`,
		'g',
	)

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const lineMatches = line?.matchAll(new RegExp(componentRegex.source, 'g')) || []

		for (const match of lineMatches) {
			const propsString = match[1]
			const props = parsePropsString(propsString)

			usages.push({
				line: i + 1,
				props,
			})
		}
	}

	return usages
}

/**
 * Parse props string from component tag
 */
function parsePropsString(propsString?: string): Record<string, string> {
	const props: Record<string, string> = {}
	if (!propsString) return props

	// Match prop="value" or prop='value' or prop={expression} or prop (boolean)
	// For expressions, handle nested braces by counting depth
	const regex = /(\w+)(?:=(?:"([^"]*)"|'([^']*)'|\{))?/g
	let match: RegExpExecArray | null
	while ((match = regex.exec(propsString)) !== null) {
		const name = match[1]
		if (!name) continue

		if (match[2] !== undefined) {
			props[name] = match[2]
		} else if (match[3] !== undefined) {
			props[name] = match[3]
		} else if (match[0].endsWith('{')) {
			// Expression: count braces to find the matching close
			let depth = 1
			const start = regex.lastIndex
			let i = start
			while (i < propsString.length && depth > 0) {
				if (propsString[i] === '{') depth++
				else if (propsString[i] === '}') depth--
				i++
			}
			props[name] = propsString.slice(start, i - 1)
			regex.lastIndex = i
		} else {
			// Boolean prop
			props[name] = 'true'
		}
	}

	return props
}
