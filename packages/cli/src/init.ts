import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { assembleConfig, extractConfigBody, findAstroConfig, findMatchingClose } from './utils'
import type { CommandOptions } from './utils'

export type InitOptions = CommandOptions

const NUA_PROVIDED_PACKAGES = [
	'@astrojs/mdx',
	'@astrojs/sitemap',
	'@tailwindcss/vite',
	'tailwindcss',
]

const NUA_MANAGED_PACKAGES = [
	'@astrojs/mdx',
	'@astrojs/sitemap',
	'@tailwindcss/vite',
]

/**
 * Detect which Nua-managed packages are explicitly imported in the config.
 * Returns a map of package specifier → local import name.
 */
export function detectNuaManagedImports(content: string): Map<string, string> {
	const managed = new Map<string, string>()
	for (const pkg of NUA_MANAGED_PACKAGES) {
		const regex = new RegExp(`import\\s+(\\w+)\\s+from\\s+['"]${pkg.replace('/', '\\/')}['"]`)
		const match = regex.exec(content)
		if (match) {
			managed.set(pkg, match[1]!)
		}
	}
	return managed
}

/**
 * Remove a function call (e.g. `mdx()` or `sitemap({ ... })`) from an array property.
 */
export function removeCallFromArray(body: string, arrayProp: string, callName: string): string {
	const propRegex = new RegExp(`\\b${arrayProp}\\s*:\\s*\\[`)
	const propMatch = propRegex.exec(body)
	if (!propMatch || propMatch.index === undefined) return body

	const arrayStart = body.indexOf('[', propMatch.index)
	const arrayEnd = findMatchingClose(body, arrayStart)
	if (arrayEnd === -1) return body

	const arrayContent = body.slice(arrayStart + 1, arrayEnd)

	const callRegex = new RegExp(`\\b${callName}\\s*\\(`)
	const callMatch = callRegex.exec(arrayContent)
	if (!callMatch || callMatch.index === undefined) return body

	const parenStart = arrayContent.indexOf('(', callMatch.index)
	const parenEnd = findMatchingClose(arrayContent, parenStart)
	if (parenEnd === -1) return body

	let removeStart = callMatch.index
	let removeEnd = parenEnd + 1

	let after = removeEnd
	while (after < arrayContent.length && (arrayContent[after] === ' ' || arrayContent[after] === '\t' || arrayContent[after] === '\n')) {
		after++
	}
	if (after < arrayContent.length && arrayContent[after] === ',') {
		removeEnd = after + 1
		while (
			removeEnd < arrayContent.length
			&& (arrayContent[removeEnd] === ' ' || arrayContent[removeEnd] === '\t' || arrayContent[removeEnd] === '\n')
		) removeEnd++
	}

	if (removeEnd === parenEnd + 1) {
		let before = removeStart - 1
		while (before >= 0 && (arrayContent[before] === ' ' || arrayContent[before] === '\t' || arrayContent[before] === '\n')) before--
		if (before >= 0 && arrayContent[before] === ',') {
			removeStart = before
		}
	}

	const newArrayContent = arrayContent.slice(0, removeStart) + arrayContent.slice(removeEnd)
	return body.slice(0, arrayStart + 1) + newArrayContent + body.slice(arrayEnd)
}

/**
 * Clean up empty structures left after removing managed integrations/plugins.
 * Removes empty arrays/objects and the Nua-default `sourcemap: true`.
 */
export function cleanEmptyStructures(body: string): string {
	body = body.replace(/\n[ \t]*sourcemap\s*:\s*true\s*,?[ \t]*/g, '\n')
	body = body.replace(/\n[ \t]*build\s*:\s*\{[\s,]*\}\s*,?[ \t]*/g, '\n')
	body = body.replace(/\n[ \t]*plugins\s*:\s*\[[\s,]*\]\s*,?[ \t]*/g, '\n')
	body = body.replace(/\n[ \t]*integrations\s*:\s*\[[\s,]*\]\s*,?[ \t]*/g, '\n')
	body = body.replace(/\n[ \t]*vite\s*:\s*\{[\s,]*\}\s*,?[ \t]*/g, '\n')

	return body
}

export function transformConfig(content: string, managedImports: Map<string, string>): string {
	const lines = content.split('\n')
	const newImports: string[] = []

	for (const line of lines) {
		if (!/^\s*import\s/.test(line)) continue

		if (line.includes('astro/config') && line.includes('defineConfig')) {
			newImports.push(`import { defineConfig } from '@nuasite/nua/config'`)
			continue
		}

		const isManagedImport = [...managedImports.keys()].some(pkg => line.includes(pkg))
		if (isManagedImport) continue

		newImports.push(line)
	}

	let body = extractConfigBody(content)

	for (const [pkg, localName] of managedImports) {
		if (pkg === '@tailwindcss/vite') {
			body = removeCallFromArray(body, 'plugins', localName)
		} else {
			body = removeCallFromArray(body, 'integrations', localName)
		}
	}

	body = cleanEmptyStructures(body)

	return assembleConfig(newImports, body)
}

function resolveNuaVersion(): string {
	try {
		const cliPkgPath = new URL('../../package.json', import.meta.url)
		const cliPkg = JSON.parse(readFileSync(cliPkgPath, 'utf-8'))
		const version: string = cliPkg.version
		const [major, minor] = version.split('.')
		return `^${major}.${minor}.0`
	} catch {
		return '^0.17.0'
	}
}

export function transformPackageJson(pkg: Record<string, any>, nuaVersion: string): Record<string, any> {
	const result = structuredClone(pkg)

	if (result.scripts) {
		for (const [key, value] of Object.entries(result.scripts)) {
			if (typeof value === 'string') {
				result.scripts[key] = value
					.replace(/\bastro build\b/g, 'nua build')
					.replace(/\bastro dev\b/g, 'nua dev')
					.replace(/\bastro preview\b/g, 'nua preview')
			}
		}
	}

	for (const field of ['dependencies', 'devDependencies'] as const) {
		if (!result[field]) continue
		for (const name of NUA_PROVIDED_PACKAGES) {
			delete result[field][name]
		}
		if (Object.keys(result[field]).length === 0) {
			delete result[field]
		}
	}

	if (!result.dependencies) result.dependencies = {}
	if (!result.dependencies['@nuasite/nua']) {
		result.dependencies['@nuasite/nua'] = nuaVersion
	}

	result.dependencies = Object.fromEntries(
		Object.entries(result.dependencies).sort(([a], [b]) => a.localeCompare(b)),
	)

	return result
}

export async function init({ cwd = process.cwd(), dryRun = false, yes = false }: InitOptions = {}) {
	const configPath = findAstroConfig(cwd)
	if (!configPath) {
		console.error('No Astro config file found.')
		process.exit(1)
	}

	const configContent = readFileSync(configPath, 'utf-8')

	if (configContent.includes('@nuasite/nua')) {
		console.log('This project already uses @nuasite/nua. Nothing to do.')
		return
	}

	if (!configContent.includes('defineConfig')) {
		console.error('Could not find defineConfig in Astro config.')
		process.exit(1)
	}

	const pkgPath = join(cwd, 'package.json')
	if (!existsSync(pkgPath)) {
		console.error('No package.json found.')
		process.exit(1)
	}
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

	const managedImports = detectNuaManagedImports(configContent)
	const nuaVersion = resolveNuaVersion()
	const configName = basename(configPath)

	console.log('')
	console.log('nua init \u2014 adopt the Nua toolchain')
	console.log('')
	console.log(`  ${configName}`)
	console.log('    - Replace astro/config with @nuasite/nua/config')
	if (managedImports.size > 0) {
		console.log(`    - Remove Nua-managed imports: ${[...managedImports.keys()].join(', ')}`)
		console.log('    - Remove managed integration/plugin calls')
	}
	console.log('    - Clean up empty config structures')
	console.log('')
	console.log('  package.json')
	const removable = NUA_PROVIDED_PACKAGES.filter(name => pkg.dependencies?.[name] || pkg.devDependencies?.[name])
	if (removable.length > 0) {
		console.log(`    - Remove Nua-provided deps: ${removable.join(', ')}`)
	}
	console.log(`    - Add @nuasite/nua ${nuaVersion}`)
	console.log('    - Update scripts: astro \u2192 nua')

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

	const newConfig = transformConfig(configContent, managedImports)
	writeFileSync(configPath, newConfig)
	console.log(`  Updated ${configName}`)

	const newPkg = transformPackageJson(pkg, nuaVersion)
	writeFileSync(pkgPath, JSON.stringify(newPkg, null, '\t') + '\n')
	console.log('  Updated package.json')

	console.log('')
	console.log('Next steps:')
	console.log('  1. bun install')
	console.log('  2. Review the updated config')
	console.log('  3. nua dev')
	console.log('')
}
