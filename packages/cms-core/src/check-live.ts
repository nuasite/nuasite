/**
 * Validate what is on disk against the project's real collection schemas.
 *
 * The AST rules in `check.ts` only type-check fields the content config types explicitly,
 * and deliberately stay silent on a plain `z.string()`. A live schema has no such blind
 * spot: it carries refinements, unions, `.min()`, coercions — everything the build will
 * actually apply. This is the same verdict `astro sync` would give, without the build.
 */

import type { CheckFinding } from './check'
import type { LoadedCollections } from './check-entries'
import type { ParsedConfig } from './content-config-ast'
import type { LiveSchemas } from './schema-port'

export interface LiveCheckInput {
	config: ParsedConfig
	collections: LoadedCollections
	schemas: LiveSchemas
}

/**
 * One finding per rejected value, with the field path zod reported.
 *
 * Entries whose frontmatter did not parse are skipped — `check.ts` already reports those,
 * and there is nothing to hand a schema.
 */
export function checkAgainstSchemas(_input: LiveCheckInput): Promise<CheckFinding[]> {
	throw new Error('checkAgainstSchemas is not implemented yet')
}
