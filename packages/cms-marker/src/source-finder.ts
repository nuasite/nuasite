import fs from 'node:fs/promises'
import path from 'node:path'

export interface SourceLocation {
	file: string
	line: number
	snippet?: string
	type?: 'static' | 'variable' | 'prop' | 'computed'
	variableName?: string
	definitionLine?: number
}

export interface VariableReference {
	name: string
	pattern: string
	definitionLine: number
}

/**
 * Find source file and line number for text content
 */
export async function findSourceLocation(
	textContent: string,
	tag: string,
): Promise<SourceLocation | undefined> {
	const srcDir = path.join(process.cwd(), 'src')

	try {
		const searchDirs = [
			path.join(srcDir, 'components'),
			path.join(srcDir, 'pages'),
			path.join(srcDir, 'layouts'),
		]

		for (const dir of searchDirs) {
			try {
				const result = await searchDirectory(dir, textContent, tag)
				if (result) {
					return result
				}
			} catch {
				// Directory doesn't exist, continue
			}
		}

		// If not found directly, try searching for prop values in parent components
		for (const dir of searchDirs) {
			try {
				const result = await searchForPropInParents(dir, textContent, tag)
				if (result) {
					return result
				}
			} catch {
				// Directory doesn't exist, continue
			}
		}
	} catch {
		// Search failed
	}

	return undefined
}

/**
 * Recursively search directory for matching content
 */
async function searchDirectory(
	dir: string,
	textContent: string,
	tag: string,
): Promise<SourceLocation | undefined> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)

			if (entry.isDirectory()) {
				const result = await searchDirectory(fullPath, textContent, tag)
				if (result) return result
			} else if (entry.isFile() && entry.name.endsWith('.astro')) {
				const result = await searchAstroFile(fullPath, textContent, tag)
				if (result) return result
			}
		}
	} catch {
		// Error reading directory
	}

	return undefined
}

/**
 * Search a single Astro file for matching content
 */
async function searchAstroFile(
	filePath: string,
	textContent: string,
	tag: string,
): Promise<SourceLocation | undefined> {
	try {
		const content = await fs.readFile(filePath, 'utf-8')
		const lines = content.split('\n')

		const cleanText = cleanTextForSearch(textContent)
		const textPreview = cleanText.slice(0, Math.min(30, cleanText.length))

		// Extract variable references from frontmatter
		const variableRefs = extractVariableReferences(content, cleanText)

		// Collect all potential matches with scores and metadata
		const matches: Array<{
			line: number
			score: number
			type: 'static' | 'variable' | 'prop' | 'computed'
			variableName?: string
			definitionLine?: number
		}> = []

		// Search for tag usage with matching text or variable
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]?.trim().toLowerCase()

			// Look for opening tag
			if (line?.includes(`<${tag.toLowerCase()}`) && !line.startsWith(`</${tag.toLowerCase()}`)) {
				// Collect content from this line and next few lines
				const section = collectSection(lines, i, 5)
				const sectionText = section.toLowerCase()
				const sectionTextOnly = stripHtmlTags(section).toLowerCase()

				let score = 0
				let matched = false

				// Check for variable reference match (highest priority)
				if (variableRefs.length > 0) {
					for (const varRef of variableRefs) {
						// Check case-insensitively since sectionText is lowercased
						if (sectionText.includes(`{`) && sectionText.includes(varRef.name.toLowerCase())) {
							score = 100
							matched = true
							// Store match metadata - this is the USAGE line, we need DEFINITION line
							matches.push({
								line: i + 1,
								score,
								type: 'variable',
								variableName: varRef.name,
								definitionLine: varRef.definitionLine,
							})
							break
						}
					}
				}

				// Check for direct text match (static content)
				if (!matched && cleanText.length > 10 && sectionTextOnly.includes(textPreview)) {
					// Score based on how much of the text matches
					const matchLength = Math.min(cleanText.length, sectionTextOnly.length)
					score = 50 + (matchLength / cleanText.length) * 40
					matched = true
					matches.push({ line: i + 1, score, type: 'static' })
				}

				// Check for short exact text match (static content)
				if (!matched && cleanText.length > 0 && cleanText.length <= 10 && sectionTextOnly.includes(cleanText)) {
					score = 80
					matched = true
					matches.push({ line: i + 1, score, type: 'static' })
				}

				// Try matching first few words for longer text (static content)
				if (!matched && cleanText.length > 20) {
					const firstWords = cleanText.split(' ').slice(0, 3).join(' ')
					if (firstWords && sectionTextOnly.includes(firstWords)) {
						score = 40
						matched = true
						matches.push({ line: i + 1, score, type: 'static' })
					}
				}
			}
		}

		// Return the best match (highest score)
		if (matches.length > 0) {
			const bestMatch = matches.reduce((best, current) => current.score > best.score ? current : best)

			// Determine the editable line (definition for variables, usage for static)
			const editableLine = bestMatch.type === 'variable' && bestMatch.definitionLine
				? bestMatch.definitionLine
				: bestMatch.line

			// Get the complete source snippet (multi-line for static, single line for variables)
			let snippet: string
			if (bestMatch.type === 'static') {
				// For static content, extract the complete tag content with indentation
				snippet = extractCompleteTagSnippet(lines, editableLine - 1, tag)
			} else {
				// For variables/props, just the definition line with indentation
				snippet = lines[editableLine - 1] || ''
			}

			return {
				file: path.relative(process.cwd(), filePath),
				line: editableLine,
				snippet,
				type: bestMatch.type,
				variableName: bestMatch.variableName,
				definitionLine: bestMatch.type === 'variable' ? bestMatch.definitionLine : undefined,
			}
		}
	} catch {
		// Error reading file
	}

	return undefined
}

/**
 * Search for prop values passed to components
 */
async function searchForPropInParents(
	dir: string,
	textContent: string,
	tag: string,
): Promise<SourceLocation | undefined> {
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		const cleanText = cleanTextForSearch(textContent)

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name)

			if (entry.isDirectory()) {
				const result = await searchForPropInParents(fullPath, textContent, tag)
				if (result) return result
			} else if (entry.isFile() && entry.name.endsWith('.astro')) {
				const content = await fs.readFile(fullPath, 'utf-8')
				const lines = content.split('\n')

				// Look for component tags with prop values matching our text
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]

					// Match component usage like <ComponentName propName="value" />
					const componentMatch = line?.match(/<([A-Z]\w+)/)
					if (!componentMatch) continue

					// Collect only the opening tag (until first > or />), not nested content
					let openingTag = ''
					let endLine = i
					for (let j = i; j < Math.min(i + 10, lines.length); j++) {
						openingTag += ' ' + lines[j]
						endLine = j

						// Stop at the end of opening tag (either /> or >)
						if (lines[j]?.includes('/>')) {
							// Self-closing tag
							break
						} else if (lines[j]?.includes('>')) {
							// Opening tag ends here, don't include nested content
							// Truncate to just the opening tag part
							const tagEndIndex = openingTag.indexOf('>')
							if (tagEndIndex !== -1) {
								openingTag = openingTag.substring(0, tagEndIndex + 1)
							}
							break
						}
					}

					// Extract all prop values from the opening tag only
					const propMatches = openingTag.matchAll(/(\w+)=["']([^"']+)["']/g)
					for (const match of propMatches) {
						const propName = match[1]
						const propValue = match[2]

						if (!propValue) {
							continue
						}

						const normalizedValue = normalizeText(propValue)

						if (normalizedValue === cleanText) {
							// Find which line actually contains this prop
							let propLine = i
							let propLineIndex = i

							for (let k = i; k <= endLine; k++) {
								const line = lines[k]
								if (!line) {
									continue
								}

								if (propName && line.includes(propName) && line.includes(propValue)) {
									propLine = k
									propLineIndex = k
									break
								}
							}

							// Extract complete component tag starting from where the component tag opens
							const componentSnippetLines: string[] = []
							for (let k = i; k <= endLine; k++) {
								const line = lines[k]
								if (!line) {
									continue
								}

								componentSnippetLines.push(line)
							}

							const propSnippet = componentSnippetLines.join('\n')

							// Found the prop being passed with our text value
							return {
								file: path.relative(process.cwd(), fullPath),
								line: propLine + 1,
								snippet: propSnippet,
								type: 'prop',
								variableName: propName,
							}
						}
					}
				}
			}
		}
	} catch {
		// Error reading directory
	}

	return undefined
}

/**
 * Extract complete tag snippet including content and indentation
 */
function extractCompleteTagSnippet(lines: string[], startLine: number, tag: string): string {
	const snippetLines: string[] = []
	let depth = 0
	let foundClosing = false

	// Start from the opening tag line
	for (let i = startLine; i < Math.min(startLine + 20, lines.length); i++) {
		const line = lines[i]

		if (!line) {
			continue
		}

		snippetLines.push(line)

		// Count opening and closing tags
		const openTags = (line.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length
		const selfClosing = (line.match(new RegExp(`<${tag}[^>]*/>`, 'gi')) || []).length
		const closeTags = (line.match(new RegExp(`</${tag}>`, 'gi')) || []).length

		depth += openTags - selfClosing - closeTags

		// If we found a self-closing tag or closed all tags, we're done
		if (selfClosing > 0 || (depth <= 0 && (closeTags > 0 || openTags > 0))) {
			foundClosing = true
			break
		}
	}

	// If we didn't find closing tag, just return the first line
	if (!foundClosing && snippetLines.length > 1) {
		return snippetLines[0]!
	}

	return snippetLines.join('\n')
}

/**
 * Extract variable references from frontmatter
 */
function extractVariableReferences(content: string, targetText: string): VariableReference[] {
	const refs: VariableReference[] = []
	const frontmatterEnd = content.indexOf('---', 3)

	if (frontmatterEnd <= 0) return refs

	const frontmatter = content.substring(0, frontmatterEnd)
	const lines = frontmatter.split('\n')

	for (const line of lines) {
		const trimmed = line.trim()

		// Match quoted text (handling escaped quotes)
		// Try single quotes with escaped quotes
		let quotedMatch = trimmed.match(/'((?:[^'\\]|\\.)*)'/)
		if (!quotedMatch) {
			// Try double quotes with escaped quotes
			quotedMatch = trimmed.match(/"((?:[^"\\]|\\.)*)"/)
		}
		if (!quotedMatch) {
			// Try backticks (template literals) - but only if no ${} interpolation
			const backtickMatch = trimmed.match(/`([^`]*)`/)
			if (backtickMatch && !backtickMatch[1]?.includes('${')) {
				quotedMatch = backtickMatch
			}
		}
		if (!quotedMatch?.[1]) continue

		const value = normalizeText(quotedMatch[1])
		const normalizedTarget = normalizeText(targetText)

		if (value !== normalizedTarget) continue

		// Try to extract variable name and line number
		const lineNumber = lines.indexOf(line) + 1

		// Pattern 1: Object property "key: 'value'"
		const propMatch = trimmed.match(/(\w+)\s*:\s*['"`]/)
		if (propMatch?.[1]) {
			refs.push({
				name: propMatch[1],
				pattern: `{.*${propMatch[1]}`,
				definitionLine: lineNumber,
			})
			continue
		}

		// Pattern 2: Variable declaration "const name = 'value'"
		const varMatch = trimmed.match(/(?:const|let|var)\s+(\w+)(?:\s*:\s*\w+)?\s*=/)
		if (varMatch?.[1]) {
			refs.push({
				name: varMatch[1],
				pattern: `{${varMatch[1]}}`,
				definitionLine: lineNumber,
			})
		}
	}

	return refs
}

/**
 * Collect text from multiple lines
 */
function collectSection(lines: string[], startLine: number, numLines: number): string {
	let text = ''
	for (let i = startLine; i < Math.min(startLine + numLines, lines.length); i++) {
		text += ' ' + lines[i]?.trim().replace(/\s+/g, ' ')
	}
	return text
}

/**
 * Strip HTML tags from text
 */
function stripHtmlTags(text: string): string {
	return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Normalize text for comparison (handles escaping and entities)
 */
function normalizeText(text: string): string {
	return text
		.trim()
		.replace(/\\'/g, "'") // Escaped single quotes
		.replace(/\\"/g, '"') // Escaped double quotes
		.replace(/&#39;/g, "'") // HTML entity for apostrophe
		.replace(/&quot;/g, '"') // HTML entity for quote
		.replace(/&apos;/g, "'") // HTML entity for apostrophe (alternative)
		.replace(/&amp;/g, '&') // HTML entity for ampersand
		.replace(/\s+/g, ' ') // Normalize whitespace
		.toLowerCase()
}

/**
 * Clean text for search comparison
 */
function cleanTextForSearch(text: string): string {
	return normalizeText(text)
}
