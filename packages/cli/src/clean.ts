import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { findAstroConfig } from './utils'

export interface CleanOptions {
	cwd?: string
	dryRun?: boolean
	yes?: boolean
}

export type FeatureKey = 'cms' | 'pageMarkdown' | 'mdx' | 'sitemap' | 'tailwindcss' | 'checks'
const FEATURE_KEYS: FeatureKey[] = ['cms', 'pageMarkdown', 'mdx', 'sitemap', 'tailwindcss', 'checks']

/** Tooling / orchestration packages — removed during clean */
const NUASITE_TOOLING = [
	'@nuasite/nua',
	'@nuasite/core',
	'@nuasite/cli',
	'@nuasite/cms',
	'@nuasite/llm-enhancements',
	'@nuasite/checks',
	'@nuasite/agent-summary',
]

const PACKAGES_TO_ADD: Record<string, string> = {
	'astro': '^6.0.2',
	'@astrojs/check': '^0.9.7',
	'@astrojs/mdx': '^5.0.0',
	'@astrojs/rss': '^4.0.17',
	'@astrojs/sitemap': '^3.7.1',
	'@tailwindcss/vite': '^4.2.1',
	'tailwindcss': '^4.2.1',
	'typescript': '^5',
}

export function detectDisabledFeatures(content: string): Set<FeatureKey> {
	const disabled = new Set<FeatureKey>()
	for (const key of FEATURE_KEYS) {
		if (new RegExp(`\\b${key}\\s*:\\s*false\\b`).test(content)) {
			disabled.add(key)
		}
	}
	return disabled
}

/**
 * Find the matching closing brace/bracket/paren, aware of string literals.
 */
function findMatchingClose(text: string, start: number): number {
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
 * Prepend items into an existing array property (e.g. `integrations: [` or `plugins: [`).
 * Mutates `lines` in place. Returns true if a merge happened.
 */
function prependToArrayProperty(lines: string[], property: string, items: string): boolean {
	const pattern = new RegExp(`\\b${property}\\s*:\\s*\\[`)
	for (let i = 0; i < lines.length; i++) {
		if (pattern.test(lines[i]!)) {
			lines[i] = lines[i]!.replace(
				new RegExp(`(\\b${property}\\s*:\\s*\\[)`),
				`$1${items}, `,
			)
			return true
		}
	}
	return false
}

export function transformConfig(content: string, disabled: Set<FeatureKey>): string {
	const userImports = content
		.split('\n')
		.filter(line => /^\s*import\s/.test(line))
		.filter(line => !line.includes('@nuasite/'))
		.filter(line => !line.includes('defineConfig'))

	let body = extractConfigBody(content)
	body = removeProperty(body, 'nua')

	if (content.includes('@nuasite/nua/integration')) {
		body = body.replace(/\bnua\s*\([^)]*\)\s*,?\s*/g, '')
		body = body.replace(/\bintegrations\s*:\s*\[\s*,?\s*\]\s*,?/g, '')
	}

	const imports = [`import { defineConfig } from 'astro/config'`]
	if (!disabled.has('tailwindcss')) imports.push(`import tailwindcss from '@tailwindcss/vite'`)
	if (!disabled.has('mdx')) imports.push(`import mdx from '@astrojs/mdx'`)
	if (!disabled.has('sitemap')) imports.push(`import sitemap from '@astrojs/sitemap'`)
	imports.push(...userImports)

	const integrationCalls: string[] = []
	if (!disabled.has('mdx')) integrationCalls.push('mdx()')
	if (!disabled.has('sitemap')) integrationCalls.push('sitemap()')

	const bodyLines = body.split('\n').filter(line => line.trim() !== '')

	const hasIntegrations = bodyLines.some(line => /^\s*integrations\s*:/.test(line))
	const hasVite = bodyLines.some(line => /^\s*vite\s*:/.test(line))

	if (hasIntegrations && integrationCalls.length > 0) {
		prependToArrayProperty(bodyLines, 'integrations', integrationCalls.join(', '))
	}

	if (!disabled.has('tailwindcss') && hasVite) {
		prependToArrayProperty(bodyLines, 'plugins', 'tailwindcss()')
	}

	const newPropLines: string[] = []

	if (!disabled.has('tailwindcss') && !hasVite) {
		newPropLines.push(
			'\tvite: {',
			'\t\tbuild: {',
			'\t\t\tsourcemap: true,',
			'\t\t},',
			'\t\tplugins: [tailwindcss()],',
			'\t},',
		)
	}

	if (!hasIntegrations && integrationCalls.length > 0) {
		newPropLines.push(`\tintegrations: [${integrationCalls.join(', ')}],`)
	}

	const allLines = [...bodyLines, ...newPropLines]

	let result = imports.join('\n') + '\n\n'
	result += 'export default defineConfig({\n'
	if (allLines.length > 0) {
		result += allLines.join('\n') + '\n'
	}
	result += '})\n'

	return result
}

export function transformPackageJson(
	pkg: Record<string, any>,
	disabled: Set<FeatureKey>,
	usedRuntimePackages: string[] = [],
): Record<string, any> {
	const result = structuredClone(pkg)

	const nuaVersion: string | undefined = result.dependencies?.['@nuasite/nua']
		?? result.devDependencies?.['@nuasite/nua']

	if (result.scripts) {
		for (const [key, value] of Object.entries(result.scripts)) {
			if (typeof value === 'string') {
				result.scripts[key] = value
					.replace(/\bnua build\b/g, 'astro build')
					.replace(/\bnua dev\b/g, 'astro dev')
					.replace(/\bnua preview\b/g, 'astro preview')
			}
		}
	}

	for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
		if (!result[field]) continue
		for (const name of NUASITE_TOOLING) {
			delete result[field][name]
		}
		if (Object.keys(result[field]).length === 0) {
			delete result[field]
		}
	}

	if (!result.dependencies) result.dependencies = {}

	for (const [name, version] of Object.entries(PACKAGES_TO_ADD)) {
		if (result.dependencies[name]) continue
		if (name === '@astrojs/mdx' && disabled.has('mdx')) continue
		if (name === '@astrojs/sitemap' && disabled.has('sitemap')) continue
		if (name === '@tailwindcss/vite' && disabled.has('tailwindcss')) continue
		if (name === 'tailwindcss' && disabled.has('tailwindcss')) continue
		result.dependencies[name] = version
	}

	// Promote runtime packages (e.g. @nuasite/components) — version mirrors @nuasite/nua
	for (const name of usedRuntimePackages) {
		if (!result.dependencies[name]) {
			result.dependencies[name] = nuaVersion ?? '^0.16.0'
		}
	}

	result.dependencies = Object.fromEntries(
		Object.entries(result.dependencies).sort(([a], [b]) => a.localeCompare(b)),
	)

	return result
}

function scanForNuasiteUsage(cwd: string): Array<{ file: string; packages: string[] }> {
	const srcDir = join(cwd, 'src')
	if (!existsSync(srcDir)) return []

	const results: Array<{ file: string; packages: string[] }> = []

	try {
		const files = readdirSync(srcDir, { recursive: true })
		for (const entry of files) {
			const fileName = String(entry)
			if (!/\.(astro|ts|tsx|js|jsx)$/.test(fileName)) continue

			try {
				const content = readFileSync(join(srcDir, fileName), 'utf-8')
				const matches = content.match(/@nuasite\/[\w-]+/g)
				if (matches) {
					results.push({
						file: join('src', fileName),
						packages: [...new Set(matches)],
					})
				}
			} catch {
				// skip unreadable files
			}
		}
	} catch {
		// src directory not readable
	}

	return results
}

export async function clean({ cwd = process.cwd(), dryRun = false, yes = false }: CleanOptions = {}) {
	const configPath = findAstroConfig(cwd)
	if (!configPath) {
		console.error('No Astro config file found.')
		process.exit(1)
	}

	const configContent = readFileSync(configPath, 'utf-8')
	if (!configContent.includes('@nuasite/nua')) {
		console.log('This project does not use @nuasite/nua. Nothing to clean.')
		return
	}

	const pkgPath = join(cwd, 'package.json')
	if (!existsSync(pkgPath)) {
		console.error('No package.json found.')
		process.exit(1)
	}
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

	const disabled = detectDisabledFeatures(configContent)
	const nuasiteUsage = scanForNuasiteUsage(cwd)
	const configName = basename(configPath)

	const usedRuntimePackages = new Set<string>()
	const toolingUsage: Array<{ file: string; packages: string[] }> = []

	for (const entry of nuasiteUsage) {
		const runtime = entry.packages.filter(p => !NUASITE_TOOLING.includes(p))
		const tooling = entry.packages.filter(p => NUASITE_TOOLING.includes(p))
		for (const p of runtime) usedRuntimePackages.add(p)
		if (tooling.length > 0) {
			toolingUsage.push({ file: entry.file, packages: tooling })
		}
	}

	console.log('')
	console.log('nua clean — eject to standard Astro project')
	console.log('')
	console.log(`  ${configName}`)
	console.log('    - Replace @nuasite/nua with explicit Astro integrations')
	console.log('    - Add mdx, sitemap, tailwindcss imports')
	if (disabled.size > 0) {
		console.log(`    - Skipping disabled: ${[...disabled].join(', ')}`)
	}
	console.log('')
	console.log('  package.json')
	console.log('    - Remove @nuasite/* tooling dependencies')
	if (usedRuntimePackages.size > 0) {
		console.log(`    - Keep as explicit deps: ${[...usedRuntimePackages].join(', ')}`)
	}
	console.log('    - Add standard Astro packages')
	console.log('    - Update scripts: nua → astro')

	if (toolingUsage.length > 0) {
		console.log('')
		console.log('  Warning: @nuasite tooling imports found in source files:')
		for (const { file, packages } of toolingUsage) {
			console.log(`    ${file} (${packages.join(', ')})`)
		}
		console.log('  These will need manual removal.')
	}

	if (dryRun) {
		console.log('')
		console.log('  (--dry-run: no changes made)')
		console.log('')
		return
	}

	if (!yes) {
		console.log('')
		const answer = prompt('Proceed? [y/N] ')
		if (answer?.toLowerCase() !== 'y') {
			console.log('Cancelled.')
			return
		}
	}

	const newConfig = transformConfig(configContent, disabled)
	writeFileSync(configPath, newConfig)
	console.log(`  Updated ${configName}`)

	const newPkg = transformPackageJson(pkg, disabled, [...usedRuntimePackages])
	writeFileSync(pkgPath, JSON.stringify(newPkg, null, '\t') + '\n')
	console.log('  Updated package.json')

	console.log('')
	console.log('Next steps:')
	console.log('  1. bun install')
	console.log('  2. Review the updated config')
	console.log('  3. astro dev')
	if (toolingUsage.length > 0) {
		console.log('  4. Remove @nuasite tooling imports from source files')
	}
	console.log('')
}
