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
			const fullPath = path.join(process.cwd(), dir)
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
	 * Parse Props content and extract individual property definitions
	 * Handles multi-line properties with nested types
	 */
	private parsePropsContent(propsContent: string): ComponentProp[] {
		const props: ComponentProp[] = []
		let i = 0
		const content = propsContent.trim()

		while (i < content.length) {
			// Skip whitespace and newlines
			while (i < content.length && /\s/.test(content[i] ?? '')) i++
			if (i >= content.length) break

			// Skip comments
			if (content[i] === '/' && content[i + 1] === '/') {
				// Skip to end of line
				while (i < content.length && content[i] !== '\n') i++
				continue
			}

			if (content[i] === '/' && content[i + 1] === '*') {
				// Skip block comment
				while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) i++
				i += 2
				continue
			}

			// Extract property name
			const nameStart = i
			while (i < content.length && /\w/.test(content[i] ?? '')) i++
			const name = content.substring(nameStart, i)

			if (!name) break

			// Skip whitespace
			while (i < content.length && /\s/.test(content[i] ?? '')) i++

			// Check for optional marker
			const optional = content[i] === '?'
			if (optional) i++

			// Skip whitespace
			while (i < content.length && /\s/.test(content[i] ?? '')) i++

			// Expect colon
			if (content[i] !== ':') break
			i++

			// Skip whitespace
			while (i < content.length && /\s/.test(content[i] ?? '')) i++

			// Extract type (up to semicolon, handling nested braces)
			const typeStart = i
			let braceDepth = 0
			let angleDepth = 0
			while (i < content.length) {
				if (content[i] === '{') braceDepth++
				else if (content[i] === '}') braceDepth--
				else if (content[i] === '<') angleDepth++
				else if (content[i] === '>') angleDepth--
				else if (content[i] === ';' && braceDepth === 0 && angleDepth === 0) break
				i++
			}

			const type = content.substring(typeStart, i).trim()

			// Skip the semicolon
			if (content[i] === ';') i++

			// Skip whitespace
			while (i < content.length && /[ \t]/.test(content[i] ?? '')) i++

			// Check for inline comment
			let description: string | undefined
			if (content[i] === '/' && content[i + 1] === '/') {
				i += 2
				const commentStart = i
				while (i < content.length && content[i] !== '\n') i++
				description = content.substring(commentStart, i).trim()
			}

			if (name && type) {
				props.push({
					name,
					type,
					required: !optional,
					description,
				})
			}
		}

		return props
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
	 * Parse a single prop line from interface/type
	 */
	private parsePropLine(line: string): ComponentProp | null {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) return null

		// Match: propName?: type; or propName: type;
		const match = trimmed.match(/^(\w+)(\?)?:\s*([^;]+);?\s*(\/\/.*)?$/)
		if (!match) return null

		const [, name, optional, typeStr, comment] = match

		if (!name || !typeStr) return null

		return {
			name,
			type: typeStr?.trim(),
			required: !optional,
			description: comment ? comment.replace(/^\/\/\s*/, '').trim() : undefined,
		}
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

	const lineIndex = 0
	const charIndex = 0

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

	// Match prop="value" or prop={expression} or prop (boolean)
	const propMatches = propsString?.matchAll(
		/(\w+)(?:=(?:["']([^"']*)["']|\{([^}]*)\}))?/g,
	) || []

	for (const match of propMatches) {
		const [, name, stringValue, expressionValue] = match
		if (name) {
			props[name] = stringValue ?? expressionValue ?? 'true'
		}
	}

	return props
}
