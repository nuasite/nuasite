import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface CommandOptions {
	cwd?: string
	dryRun?: boolean
	yes?: boolean
}

const CONFIG_NAMES = [
	'astro.config.ts',
	'astro.config.mts',
	'astro.config.mjs',
	'astro.config.js',
]

export function findAstroConfig(cwd: string = process.cwd()): string | null {
	for (const name of CONFIG_NAMES) {
		const p = join(cwd, name)
		if (existsSync(p)) return p
	}
	return null
}

/**
 * Find the matching closing brace/bracket/paren, aware of string literals.
 */
export function findMatchingClose(text: string, start: number): number {
	const open = text[start]!
	const close = open === '{' ? '}' : open === '[' ? ']' : ')'
	let depth = 0
	let inString: string | false = false

	for (let i = start; i < text.length; i++) {
		const ch = text[i]

		if (inString) {
			if (ch === '\\') {
				i++
				continue
			}
			if (ch === inString) inString = false
			continue
		}

		if (ch === "'" || ch === '"' || ch === '`') {
			inString = ch
			continue
		}

		if (ch === open) depth++
		if (ch === close) {
			depth--
			if (depth === 0) return i
		}
	}

	return -1
}

/**
 * Extract the text between the outermost { } of defineConfig({ ... })
 */
export function extractConfigBody(content: string): string {
	const match = content.match(/defineConfig\s*\(\s*\{/)
	if (!match || match.index === undefined) return ''

	const openBrace = content.indexOf('{', match.index + 'defineConfig'.length)
	const closeBrace = findMatchingClose(content, openBrace)
	if (closeBrace === -1) return ''

	return content.slice(openBrace + 1, closeBrace)
}

/**
 * Remove a top-level property from an object literal body text.
 */
export function removeProperty(body: string, propName: string): string {
	const regex = new RegExp(`(\\n[ \\t]*)${propName}\\s*:\\s*`)
	const match = regex.exec(body)
	if (!match || match.index === undefined) return body

	const propLineStart = match.index + 1 // skip the leading \n
	const afterMatch = match.index + match[0].length

	// Skip whitespace (not newlines) before the value
	let i = afterMatch
	while (i < body.length && (body[i] === ' ' || body[i] === '\t')) i++

	let valueEnd: number

	if (body[i] === '{' || body[i] === '[') {
		valueEnd = findMatchingClose(body, i)
		if (valueEnd === -1) return body
		valueEnd++ // include closing brace/bracket
	} else {
		// Simple value (false, true, number, string, variable)
		while (i < body.length && body[i] !== ',' && body[i] !== '\n') i++
		valueEnd = i
	}

	// Skip trailing comma and whitespace up to newline
	let end = valueEnd
	while (end < body.length && (body[end] === ' ' || body[end] === '\t')) end++
	if (end < body.length && body[end] === ',') end++
	while (end < body.length && (body[end] === ' ' || body[end] === '\t')) end++
	if (end < body.length && body[end] === '\n') end++

	return body.slice(0, propLineStart) + body.slice(end)
}

/**
 * Assemble a complete config file from import lines and a body string.
 */
export function assembleConfig(imports: string[], body: string): string {
	const bodyLines = body.split('\n').filter(line => line.trim() !== '')

	let result = imports.join('\n') + '\n\n'
	result += 'export default defineConfig({\n'
	if (bodyLines.length > 0) {
		result += bodyLines.join('\n') + '\n'
	}
	result += '})\n'

	return result
}
