import {
	CLOUDFLARE_REDIRECT_LIMITS,
	CMS_REDIRECTS_FILE,
	mergeRedirects,
	parseRedirectRule,
	type RedirectLayer,
	type RedirectLine,
} from '@nuasite/cms-core'
import type { AstroConfig } from 'astro'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isNodeError } from './utils.ts'

export interface RedirectsLogger {
	info: (message: string) => void
	warn: (message: string) => void
}

export interface MergeRedirectsIntoOptions {
	/**
	 * Arrange the layers to merge, earliest first in precedence, around `built`: what the build output's
	 * `_redirects` already holds (the copy of `public/_redirects`, or an earlier step's merge).
	 */
	arrange: (built: RedirectLayer) => RedirectLayer[]
	/** Name of what `built` holds, for messages. */
	builtName: string
	/** Warn when the merged file goes over Cloudflare Pages' limits. Only the step that merges last should. */
	warnLimits: boolean
}

/**
 * Merge redirect rules into the build output's `_redirects` (`dir` is the directory Astro hands
 * `astro:build:done`). A rule that loses to one for the same source is logged, and so is one a pattern
 * from higher up reaches first. A line not read as a rule is kept as written. When the merge leaves the
 * lines as they were, the file is not rewritten, so a hand-written `public/_redirects` keeps its
 * comments and layout.
 */
export async function mergeRedirectsInto(dir: URL, logger: RedirectsLogger, options: MergeRedirectsIntoOptions): Promise<void> {
	const target = new URL('_redirects', dir)
	const built = await readIfPresent(target)
	const builtLayer = { name: options.builtName, text: built ?? '' }
	const merged = mergeRedirects(options.arrange(builtLayer))

	for (const { kept, dropped } of merged.overridden) {
		logger.warn(`Redirect ${at(dropped)} is overridden by ${at(kept)}`)
	}
	for (const { by, rule } of merged.shadowed) {
		logger.warn(`Redirect ${at(rule)} is never reached: ${at(by)} matches it first`)
	}
	for (const { rule, reason } of merged.refused) {
		logger.warn(`Left out redirect ${at(rule)}: ${reason}`)
	}
	for (const line of merged.unrecognised) {
		logger.info(`Kept ${at(line)} as written: not read as a rule, so it is not merged`)
	}
	if (options.warnLimits) {
		const { exact, pattern } = merged.counts
		if (exact > CLOUDFLARE_REDIRECT_LIMITS.exact || pattern > CLOUDFLARE_REDIRECT_LIMITS.pattern) {
			logger.warn(
				`_redirects holds ${exact} exact and ${pattern} pattern rules; Cloudflare Pages allows ${CLOUDFLARE_REDIRECT_LIMITS.exact} and ${CLOUDFLARE_REDIRECT_LIMITS.pattern}`,
			)
		}
	}

	// Compared with the lines as written, so a repeat or an unreadable line already in the file gets it
	// rewritten too: a file that lists a source twice is the one a host rejects.
	if (sameLines(writtenLines(builtLayer.text), merged.lines)) return
	await fs.writeFile(target, merged.text, 'utf-8')
	logger.info(`Merged _redirects: ${merged.lines.length} lines`)
}

/**
 * The `redirects` of an Astro config as `_redirects` lines. Paths are root-relative, as Astro reads a
 * key (`'old'` is `/old`; a destination without a slash gets one too, since a host needs a path or a
 * URL), and route params become the host's placeholders: `[...rest]` a `*` splat, `[slug]` a `:slug`.
 */
export function astroRedirectLines(redirects: AstroConfig['redirects']): string {
	// A URL, protocol-relative `//host/…` included, stays as written.
	const rooted = (p: string) => /^(https?:)?\/\//.test(p) ? p : `/${p.replace(/^\/+/, '')}`
	// Astro's own rule for a param name, so nothing it accepts is left in brackets.
	const param = /\[([\w$]+)\]/g
	return Object.entries(redirects ?? {}).map(([from, value]) => {
		const destination = typeof value === 'string' ? value : value.destination
		const status = typeof value === 'string' ? 307 : (value.status ?? 307)
		const source = rooted(from).replace(/\[\.\.\.[\w$]+\]/g, '*').replace(param, ':$1')
		const target = rooted(destination).replace(/\[\.\.\.[\w$]+\]/g, ':splat').replace(param, ':$1')
		return `${source} ${target} ${status}`
	}).join('\n')
}

/**
 * Merge an Astro config's `redirects` into the copy of `public/_redirects` in the build output. A rule
 * written by hand wins over one from the config.
 */
export function mergeConfigRedirectsInto(dir: URL, logger: RedirectsLogger, redirects: AstroConfig['redirects'], warnLimits: boolean): Promise<void> {
	const config = astroRedirectLines(redirects)
	return mergeRedirectsInto(dir, logger, {
		builtName: 'public/_redirects',
		arrange: built => [built, { name: 'redirects in the Astro config', text: config }],
		warnLimits,
	})
}

async function readIfPresent(file: URL): Promise<string | undefined> {
	try {
		return await fs.readFile(file, 'utf-8')
	} catch (error) {
		if (isNodeError(error, 'ENOENT')) return undefined
		throw error
	}
}

/** The lines of a `_redirects` text as the merge writes them, comments left out. */
function writtenLines(text: string): string[] {
	return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => parseRedirectRule(l)?.text ?? l)
}

function sameLines(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((rule, i) => rule === b[i])
}

function at(line: RedirectLine): string {
	return `${line.layer}:${line.lineNumber} "${line.line}"`
}

/**
 * Merge the redirects editors keep in `<projectRoot>/src/_redirects` into the build output's
 * `_redirects`, ahead of every rule from code: an editor's rule for a path is the newer decision
 * about it.
 */
export async function mergeCmsRedirectsInto(dir: URL, projectRoot: string, logger: RedirectsLogger): Promise<void> {
	const cms = await readIfPresent(pathToFileURL(join(projectRoot, CMS_REDIRECTS_FILE))) ?? ''
	await mergeRedirectsInto(dir, logger, {
		builtName: 'dist/_redirects',
		// Editors may redirect, but not undo a guard from code: see `RedirectLayer.restricted`.
		arrange: built => [{ name: CMS_REDIRECTS_FILE, text: cms, restricted: true }, built],
		warnLimits: true,
	})
}
