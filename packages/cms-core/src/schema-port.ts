/**
 * The port through which a project's real collection schemas reach the checker.
 *
 * `cms-core` deliberately does not load them. Getting a live schema means importing the
 * project's `content.config.ts`, which executes project code, needs an `astro:content`
 * stub installed process-wide, and caches the module for the life of the process — all
 * fine in a one-shot CLI, none of it acceptable inside the long-running dev server and
 * sidecar that also load this package. The CLI does the loading and injects the result.
 *
 * `safeParse` is async because that is how Astro validates content
 * (`astro/dist/content/utils.js` calls `safeParseAsync`), so a schema carrying an async
 * refinement is legal and a synchronous parse would throw on it.
 */

export interface LiveIssue {
	/** Path to the offending value, as zod reports it: `['stats', 0, 'label']`. */
	path: (string | number)[]
	message: string
}

export type LiveParseResult = { success: true } | { success: false; issues: LiveIssue[] }

export interface LiveSchema {
	safeParse(value: unknown): Promise<LiveParseResult>
}

/** Keyed by collection name. A collection missing from here has no live schema and is skipped. */
export type LiveSchemas = Record<string, LiveSchema>

/**
 * Render an issue as a finding's `field` and `message`.
 *
 * Shared so the two live checkers phrase the same rejection identically — they report
 * different actions but the same schema verdict, and a reader comparing them should not
 * have to wonder whether a wording difference means something.
 */
export function describeIssue(issue: LiveIssue): { field?: string; message: string } {
	if (issue.path.length === 0) return { message: issue.message }
	const field = issue.path.join('.')
	return { field, message: `${field}: ${issue.message}` }
}

/** A collection's live schema, if it has one. Guards against inherited `Object.prototype` keys. */
export function schemaFor(schemas: LiveSchemas, collection: string): LiveSchema | undefined {
	return Object.hasOwn(schemas, collection) ? schemas[collection] : undefined
}
