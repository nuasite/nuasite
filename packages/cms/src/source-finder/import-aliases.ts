import path from 'node:path'

import { getProjectRoot } from '../config.ts'
import { currentProjectContext, projectFiles } from '../project/context.ts'

/** One `compilerOptions.paths` pattern, split at its `*`, with targets made absolute. */
interface PathAlias {
	prefix: string
	/** `undefined` for a pattern without `*`, which matches only itself. */
	suffix: string | undefined
	targets: string[]
}

/** The import aliases a project's `tsconfig.json` declares, longest prefix first. */
export interface ImportAliases {
	aliases: PathAlias[]
	/** `compilerOptions.baseUrl`, absolute: bare specifiers also resolve under it. */
	baseUrl: string | undefined
}

const MAX_EXTENDS_DEPTH = 8

/**
 * The absolute paths an aliased specifier (`@/components/Card.astro`, `~/lib/data`) may stand for,
 * in the order TypeScript tries them, extension not yet applied. Empty when no alias matches.
 */
export async function aliasedImportCandidates(source: string): Promise<string[]> {
	const { aliases, baseUrl } = await projectImportAliases()
	let best: { alias: PathAlias; captured: string } | undefined
	for (const alias of aliases) {
		const captured = matchAlias(alias, source)
		if (captured === undefined) continue
		if (!best || alias.prefix.length > best.alias.prefix.length) best = { alias, captured }
	}
	if (best) {
		const { alias, captured } = best
		return alias.targets.map(target => target.replace('*', captured))
	}
	return baseUrl ? [path.join(baseUrl, source)] : []
}

function matchAlias(alias: PathAlias, source: string): string | undefined {
	if (alias.suffix === undefined) return source === alias.prefix ? '' : undefined
	if (!source.startsWith(alias.prefix) || !source.endsWith(alias.suffix)) return undefined
	if (source.length < alias.prefix.length + alias.suffix.length) return undefined
	return source.slice(alias.prefix.length, source.length - alias.suffix.length)
}

function projectImportAliases(): Promise<ImportAliases> {
	const state = currentProjectContext().state
	state.importAliases ??= readImportAliases(path.join(getProjectRoot(), 'tsconfig.json'))
	return state.importAliases
}

/**
 * Read `paths` and `baseUrl` from a tsconfig and the configs it `extends` by relative path. A
 * package config (`astro/tsconfigs/strict`) is not followed: those declare no aliases.
 */
async function readImportAliases(configPath: string, depth = 0): Promise<ImportAliases> {
	const none: ImportAliases = { aliases: [], baseUrl: undefined }
	let config: unknown
	try {
		config = parseJsonc(await projectFiles().readFile(configPath))
	} catch {
		return none
	}
	if (!isRecord(config)) return none

	let inherited = none
	const extendsList = typeof config.extends === 'string' ? [config.extends] : Array.isArray(config.extends) ? config.extends : []
	for (const parent of extendsList) {
		if (depth >= MAX_EXTENDS_DEPTH || typeof parent !== 'string' || !parent.startsWith('.')) continue
		const parentPath = path.resolve(path.dirname(configPath), parent.endsWith('.json') ? parent : `${parent}.json`)
		const parentAliases = await readImportAliases(parentPath, depth + 1)
		inherited = {
			aliases: parentAliases.aliases.length > 0 ? parentAliases.aliases : inherited.aliases,
			baseUrl: parentAliases.baseUrl ?? inherited.baseUrl,
		}
	}

	const options = isRecord(config.compilerOptions) ? config.compilerOptions : {}
	const configDir = path.dirname(configPath)
	const baseUrl = typeof options.baseUrl === 'string' ? path.resolve(configDir, options.baseUrl) : inherited.baseUrl
	if (!isRecord(options.paths)) return { aliases: inherited.aliases, baseUrl }

	// Targets resolve against baseUrl when there is one, else against the config declaring them.
	const targetBase = baseUrl ?? configDir
	const aliases: PathAlias[] = []
	for (const [pattern, targets] of Object.entries(options.paths)) {
		if (!Array.isArray(targets)) continue
		const star = pattern.indexOf('*')
		aliases.push({
			prefix: star < 0 ? pattern : pattern.slice(0, star),
			suffix: star < 0 ? undefined : pattern.slice(star + 1),
			targets: targets.filter(target => typeof target === 'string').map(target => path.resolve(targetBase, target)),
		})
	}
	return { aliases, baseUrl }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse tsconfig's JSON dialect: JSON with comments and trailing commas. */
export function parseJsonc(text: string): unknown {
	let out = ''
	let i = 0
	while (i < text.length) {
		const char = text[i]!
		if (char === '"') {
			let end = i + 1
			while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
			out += text.slice(i, end + 1)
			i = end + 1
		} else if (char === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') i++
		} else if (char === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2)
			i = end < 0 ? text.length : end + 2
		} else {
			if (char !== ',' || !closesNext(text, i + 1)) out += char
			i++
		}
	}
	return JSON.parse(out)
}

/** Whether the next token after `from`, past whitespace and comments, closes an object or array. */
function closesNext(text: string, from: number): boolean {
	let i = from
	while (i < text.length) {
		if (/\s/.test(text[i]!)) i++
		else if (text.startsWith('//', i)) i = text.includes('\n', i) ? text.indexOf('\n', i) : text.length
		else if (text.startsWith('/*', i)) i = text.includes('*/', i + 2) ? text.indexOf('*/', i + 2) + 2 : text.length
		else return text[i] === '}' || text[i] === ']'
	}
	return false
}
