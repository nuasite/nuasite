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
