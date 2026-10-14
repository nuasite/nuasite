/**
 * Merge the `_redirects` rules a site gets from several places into the one file a host reads.
 *
 * A nua site has three: `src/_redirects`, which editors maintain through the CMS, the hand-written
 * `public/_redirects`, and the `redirects` map in the Astro config. Each used to be written into
 * `dist/_redirects` on its own, so a path redirected in two of them was listed twice. Cloudflare
 * Pages rejects a file with a repeated source, and with it the whole deploy.
 *
 * Only what is understood is changed: a line this reader cannot take apart (a Netlify role gate with
 * no destination, a trailing comment) is kept as written, where it was. Merging is idempotent, so it
 * does not matter which build step merges last, or how often.
 */

/** Where the CMS keeps the redirects editors manage, relative to the project root. */
export const CMS_REDIRECTS_FILE = 'src/_redirects'

/** One source of rules, in the order of precedence the caller passes them (first wins). */
export interface RedirectLayer {
	/** Where the rules come from, for messages: `src/_redirects`, `public/_redirects`. */
	name: string
	text: string
	/**
	 * Rules written by people with less say over the site than its code, such as CMS editors. Such a
	 * layer may only redirect (a 3xx status, no conditions, so no proxying), and none of its rules may
	 * touch a path a guard from an unrestricted layer covers: a role gate, a 4xx, or any line not read
	 * as a rule. Otherwise an editor's rule, listed first, could take access control off a path.
	 */
	restricted?: boolean
}

export interface RedirectLine {
	layer: string
	/** 1-based line number within its layer's text. */
	lineNumber: number
	line: string
}

export interface MergedRedirects {
	/** The merged file, or `''` when no layer holds a rule. */
	text: string
	/** The lines written, in order: rules with their fields joined by single spaces, other lines as written. */
	lines: string[]
	/** Rules dropped for a rule with the same source (and conditions) earlier in precedence. */
	overridden: Array<{ kept: RedirectLine; dropped: RedirectLine }>
	/** Rules kept but never reached: a pattern from a layer of higher precedence matches their source first. */
	shadowed: Array<{ by: RedirectLine; rule: RedirectLine }>
	/** Lines not read as a rule, kept as written. */
	unrecognised: RedirectLine[]
	/** Rules of a restricted layer left out: not a plain redirect, or touching a path a guard from code covers. */
	refused: Array<{ rule: RedirectLine; reason: string }>
	/** Rules with a literal source, and rules with a `*` or `:placeholder` in it. */
	counts: { exact: number; pattern: number }
}

/**
 * Cloudflare Pages' limits on a `_redirects` file. Netlify has none, so going over them is worth a
 * warning, not a failed build.
 */
export const CLOUDFLARE_REDIRECT_LIMITS = { exact: 2000, pattern: 100 } as const

const HEADER = '# Merged by @nuasite. A host applies the first rule that matches, so each source of rules\n'
	+ '# is listed ahead of the ones it takes precedence over.\n'

/** One `_redirects` line, read the way a host reads it. */
export interface RedirectRuleLine {
	source: string
	destination: string
	/** The status as written (`301`, `302!`), or `undefined` for the host's default. */
	status: string | undefined
	/** Netlify query matches (`id=:id`) and conditions (`Language=cs`). */
	conditions: string[]
	/** Source plus conditions: two rules with the same key are the same rule. */
	key: string
	/** A `*` or `:placeholder` in the source's path. */
	pattern: boolean
	/** The fields joined by single spaces. */
	text: string
}

const isTarget = (field: string) => field.startsWith('/') || /^https?:\/\/\S/.test(field)
const isCondition = (field: string) => field.includes('=') && !isTarget(field)
const pathOf = (source: string) => source.replace(/^https?:\/\/[^/]*/, '')

/**
 * Read one `_redirects` line: `source [query matches] destination [status] [conditions]`. `undefined`
 * for a line that does not have that shape, such as one with no destination, a source or destination
 * that is not a path or URL, a status that is not a three-digit code, or a stray field.
 */
export function parseRedirectRule(line: string): RedirectRuleLine | undefined {
	const fields = line.trim().split(/\s+/)
	const source = fields.shift()
	if (!source || !isTarget(source)) return undefined

	const conditions: string[] = []
	while (fields[0] !== undefined && isCondition(fields[0])) conditions.push(fields.shift()!)
	const destination = fields.shift()
	if (!destination || !isTarget(destination)) return undefined
	const status = fields[0] !== undefined && /^\d{3}!?$/.test(fields[0]) ? fields.shift() : undefined
	while (fields[0] !== undefined && isCondition(fields[0])) conditions.push(fields.shift()!)
	if (fields.length > 0) return undefined

	return {
		source,
		destination,
		status,
		conditions,
		key: [source, ...conditions.toSorted()].join(' '),
		pattern: /\*|:[A-Za-z_]/.test(pathOf(source)),
		text: line.trim().split(/\s+/).join(' '),
	}
}

type Entry =
	| { kind: 'rule'; at: RedirectLine; rule: RedirectRuleLine; layer: number }
	| { kind: 'line'; at: RedirectLine }

/**
 * Merge `layers`, earlier layers taking precedence. Each layer's lines are written as a block, in their
 * own order, ahead of every layer they take precedence over: a host applies the first rule that
 * matches, so a higher layer wins for every path it covers, by an exact rule or by a pattern, and the
 * order an author chose within a file is kept. Two rules are the same rule when they share a source
 * and, for Netlify, the same conditions (`Language=cs`) and query matches (`id=:id`); the first wins.
 */
export function mergeRedirects(layers: RedirectLayer[]): MergedRedirects {
	const entries: Entry[] = []
	const kept = new Map<string, Entry & { kind: 'rule' }>()
	const overridden: MergedRedirects['overridden'] = []
	const unrecognised: RedirectLine[] = []

	const refused: MergedRedirects['refused'] = []
	const guards = layers.filter(l => !l.restricted).flatMap(l => guardSources(l.text))

	layers.forEach((layer, layerIndex) => {
		const lines = layer.text.split('\n')
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!.trim()
			if (!line || line.startsWith('#')) continue
			const at: RedirectLine = { layer: layer.name, lineNumber: i + 1, line }
			const rule = parseRedirectRule(line)
			if (layer.restricted) {
				const reason = refusal(rule, guards)
				if (reason) {
					refused.push({ rule: at, reason })
					continue
				}
			}
			if (!rule) {
				unrecognised.push(at)
				entries.push({ kind: 'line', at })
				continue
			}
			const existing = kept.get(rule.key)
			if (existing) {
				if (existing.rule.text !== rule.text) overridden.push({ kept: existing.at, dropped: at })
				continue
			}
			const entry = { kind: 'rule' as const, at, rule, layer: layerIndex }
			kept.set(rule.key, entry)
			entries.push(entry)
		}
	})

	const lines = entries.map(e => e.kind === 'rule' ? e.rule.text : e.at.line)
	const pattern = entries.filter(e => e.kind === 'rule' && e.rule.pattern).length
	return {
		text: lines.length ? `${HEADER}${lines.join('\n')}\n` : '',
		lines,
		overridden,
		shadowed: findShadowed(entries),
		unrecognised,
		refused,
		counts: { exact: lines.length - pattern, pattern },
	}
}

/** Exact rules a pattern from a layer of higher precedence reaches first. Conditional patterns may not apply, so they shadow nothing. */
function findShadowed(entries: Entry[]): MergedRedirects['shadowed'] {
	const patterns = entries.flatMap(e =>
		e.kind === 'rule' && e.rule.pattern && e.rule.conditions.length === 0 ? [{ entry: e, matches: patternMatcher(e.rule.source) }] : []
	)
	const shadowed: MergedRedirects['shadowed'] = []
	for (const e of entries) {
		if (e.kind !== 'rule' || e.rule.pattern) continue
		const by = patterns.find(p => p.entry.layer < e.layer && p.matches.test(e.rule.source))
		if (by) shadowed.push({ by: by.entry.at, rule: e.at })
	}
	return shadowed
}

function patternMatcher(source: string): RegExp {
	const escaped = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
	return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/:[A-Za-z_]\w*/g, '[^/]+')}$`)
}

const isPlainRedirect = (rule: RedirectRuleLine) => rule.conditions.length === 0 && (rule.status === undefined || /^30[12378]!?$/.test(rule.status))

/**
 * The sources of the lines in an unrestricted layer that control access to a path: one with
 * conditions (a role gate), a 4xx status (a refusal), or a line not read as a rule at all, which may
 * be either. A plain rewrite (`200` with no conditions) only serves a path from elsewhere, so an
 * editor may still redirect it, for instance to a replacement file.
 */
function guardSources(text: string): string[] {
	return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).flatMap(line => {
		const rule = parseRedirectRule(line)
		if (rule && rule.conditions.length === 0 && !/^4/.test(rule.status ?? '')) return []
		return [rule?.source ?? line.split(/\s+/)[0]!]
	})
}

/** Why a restricted layer's line may not be merged, or `undefined` when it may. */
function refusal(rule: RedirectRuleLine | undefined, guards: string[]): string | undefined {
	if (!rule) return 'not read as a rule'
	if (!isPlainRedirect(rule)) return 'only a redirect with a 3xx status and no conditions is allowed here'
	const guard = guards.find(g => overlaps(g, rule.source))
	if (guard) return `${guard} is guarded in code`
	return undefined
}

/**
 * Whether some request path could match both sources. Deliberately looser than any host: paths are
 * compared decoded and case-insensitively, without repeated or trailing slashes, a `:param` matches any
 * one segment, and a segment with a `*` matches anything from there on, nothing included (so
 * `/admin/*` covers `/admin`). A guard must not be passed by spelling its path another way.
 */
function overlaps(a: string, b: string): boolean {
	const as = segments(a)
	const bs = segments(b)
	for (let i = 0;; i++) {
		const x = as[i]
		const y = bs[i]
		if (x?.includes('*') || y?.includes('*')) return true
		if (x === undefined || y === undefined) return x === y
		if (x !== y && !x.startsWith(':') && !y.startsWith(':')) return false
	}
}

function segments(source: string): string[] {
	let path = pathOf(source)
	try {
		path = decodeURIComponent(path)
	} catch {
		// Malformed escapes: compare as written.
	}
	return path.toLowerCase().split('/').filter(Boolean)
}
