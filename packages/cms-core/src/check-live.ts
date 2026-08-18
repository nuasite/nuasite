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
import { describeIssue, type LiveParseResult, type LiveSchemas, schemaFor } from './schema-port'

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
export async function checkAgainstSchemas(input: LiveCheckInput): Promise<CheckFinding[]> {
	const findings: CheckFinding[] = []

	for (const collection of input.collections.values()) {
		const schema = schemaFor(input.schemas, collection.name)
		// No live schema for this collection means no opinion, not a pass.
		if (!schema) continue

		for (const entry of collection.entries) {
			if (entry.frontmatter === undefined) continue

			let result: LiveParseResult
			try {
				result = await schema.safeParse(entry.frontmatter)
			} catch (error) {
				// An injected schema that throws must not take down a report of real problems.
				findings.push({
					severity: 'error',
					code: 'entry/schema-rejected',
					file: entry.file,
					message: `The collection schema threw while validating this entry: ${error instanceof Error ? error.message : String(error)}`,
				})
				continue
			}
			if (result.success) continue

			// Every issue, not just the first — reporting the whole entry in one pass is the point.
			for (const issue of result.issues) {
				findings.push({ severity: 'error', code: 'entry/schema-rejected', file: entry.file, ...describeIssue(issue) })
			}
		}
	}

	return findings
}
