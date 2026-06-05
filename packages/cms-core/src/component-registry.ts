import { parse as parseBabel } from '@babel/parser'
import type { ComponentDefinition, ComponentProp } from '@nuasite/cms-types'
import path from 'node:path'
import type { CmsFileSystem } from './fs/types'

/**
 * Scan Astro component files under the given directories and extract their
 * definitions (props, slots, description, preview width) over the FileSystem
 * port.
 *
 * Ported verbatim from `@nuasite/cms`'s `ComponentRegistry` so that the
 * `componentDefinitions` resolved internally by `updateEntry` (for MDX import
 * injection) match the manifest-fed definitions used by the legacy handler. The
 * only behavioral difference is the I/O boundary: directory walking and file
 * reads go through `CmsFileSystem` instead of `node:fs` + `getProjectRoot()`.
 */
export async function scanComponentDefinitions(
	fs: CmsFileSystem,
	componentDirs: string[] = ['src/components'],
): Promise<Record<string, ComponentDefinition>> {
	const components: Record<string, ComponentDefinition> = {}

	for (const dir of componentDirs) {
		await scanDirectory(fs, dir, components)
	}

	return components
}

async function scanDirectory(
	fs: CmsFileSystem,
	relativePath: string,
	components: Record<string, ComponentDefinition>,
): Promise<void> {
	const entries = await fs.list(relativePath)

	for (const entry of entries) {
		const relPath = `${relativePath}/${entry.name}`

		if (entry.isDirectory) {
			await scanDirectory(fs, relPath, components)
		} else if (entry.name.endsWith('.astro')) {
			await parseComponent(fs, relPath, components)
		}
	}
}

async function parseComponent(
	fs: CmsFileSystem,
	relativePath: string,
	components: Record<string, ComponentDefinition>,
): Promise<void> {
	const content = await fs.readFile(relativePath)
	const componentName = path.basename(relativePath, '.astro')

	const props = extractProps(content)
	const slots = extractSlots(content)
	const description = extractDescription(content)
	const previewWidth = extractPreviewWidth(content)

	components[componentName] = {
		name: componentName,
		file: relativePath,
		props,
		slots: slots.length > 0 ? slots : undefined,
		description,
		previewWidth,
	}
}

/**
 * Parse Props content using @babel/parser AST for correct TypeScript handling.
 * Wraps the content in a synthetic interface and walks TSPropertySignature nodes.
 */
function parsePropsContent(propsContent: string): ComponentProp[] {
	const props: ComponentProp[] = []

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

	const lines = synthetic.split('\n')

	for (const member of interfaceNode.body.body) {
		if (member.type !== 'TSPropertySignature') continue
		if (member.key.type !== 'Identifier') continue

		const name = member.key.name
		const optional = !!member.optional

		let type = 'unknown'
		if (member.typeAnnotation?.typeAnnotation) {
			const ta = member.typeAnnotation.typeAnnotation
			if (ta.loc) {
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
				type = typeAnnotationToString(ta)
			}
		}

		let description: string | undefined

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

		if (!description && member.leadingComments && member.leadingComments.length > 0) {
			const last = member.leadingComments[member.leadingComments.length - 1]!
			if (last.type === 'CommentBlock') {
				description = last.value
					.split('\n')
					.map((l: string) => l.replace(/^\s*\*\s?/, '').trim())
					.filter(Boolean)
					.join(' ')
			} else if (last.type === 'CommentLine' && last.loc && member.loc) {
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

function typeAnnotationToString(node: any): string {
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
			return `${typeAnnotationToString(node.elementType)}[]`
		case 'TSUnionType':
			return node.types.map((t: any) => typeAnnotationToString(t)).join(' | ')
		case 'TSIntersectionType':
			return node.types.map((t: any) => typeAnnotationToString(t)).join(' & ')
		case 'TSLiteralType':
			if (node.literal.type === 'StringLiteral') return `'${node.literal.value}'`
			return String(node.literal.value)
		case 'TSTypeReference':
			if (node.typeName?.type === 'Identifier') return node.typeName.name
			return 'unknown'
		case 'TSParenthesizedType':
			return `(${typeAnnotationToString(node.typeAnnotation)})`
		default:
			return 'unknown'
	}
}

/** Extract content between balanced braces after a pattern match. */
function extractBalancedBraces(text: string, pattern: RegExp): string | null {
	const match = text.match(pattern)
	if (!match || match.index === undefined) return null

	const startIndex = match.index + match[0].length
	let depth = 1
	let i = startIndex

	while (i < text.length && depth > 0) {
		if (text[i] === '{') {
			depth++
		} else if (text[i] === '}') {
			depth--
		}
		i++
	}

	if (depth !== 0) return null

	return text.substring(startIndex, i - 1)
}

function extractProps(content: string): ComponentProp[] {
	const props: ComponentProp[] = []

	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
	if (!frontmatterMatch?.[1]) return props

	const frontmatter = frontmatterMatch[1]

	const propsInterfaceContent = extractBalancedBraces(frontmatter, /interface\s+Props\s*\{/)
	if (propsInterfaceContent) {
		props.push(...parsePropsContent(propsInterfaceContent))
	}

	if (props.length === 0) {
		const typePropsContent = extractBalancedBraces(frontmatter, /type\s+Props\s*=\s*\{/)
		if (typePropsContent) {
			props.push(...parsePropsContent(typePropsContent))
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

function extractSlots(content: string): string[] {
	const slots: string[] = []

	const slotMatches = content.matchAll(/<slot\s+name=["']([^"']+)["']/g)
	for (const match of slotMatches) {
		if (match[1]) {
			slots.push(match[1])
		}
	}

	const allSlotTags = content.matchAll(/<slot(?:\s+[^>]*)?\s*\/?>/g)
	for (const match of allSlotTags) {
		const tag = match[0]
		if (!/name\s*=/.test(tag)) {
			if (!slots.includes('default')) {
				slots.unshift('default')
			}
			break
		}
	}

	return slots
}

function extractDescription(content: string): string | undefined {
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

function extractPreviewWidth(content: string): number | undefined {
	const match = content.match(/^---\n\/\*\*\s*([\s\S]*?)\s*\*\//)
	if (match?.[1]) {
		const widthMatch = match[1].match(/@previewWidth\s+(\d+)/)
		if (widthMatch?.[1]) {
			return parseInt(widthMatch[1], 10)
		}
	}
	return undefined
}
