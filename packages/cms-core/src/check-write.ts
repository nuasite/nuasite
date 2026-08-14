/**
 * Predict the writes the editor is about to make, and whether the schema will take them.
 *
 * Everything else here validates content that already exists. This runs before the mistake:
 * it builds the exact frontmatter the CMS would write for an editorial action and parses it
 * against the live schema. A rejection is a build that will break the next time someone
 * performs that action — not a guess, since the write shape comes from
 * `editor-write-model.ts`, which the editor itself uses.
 *
 * Two actions are simulated:
 *
 * - **new entry** — `newEntryFrontmatter` then `omitEmptyOnCreate`. Note what this means:
 *   a field left empty arrives *absent*, not as `''`, so the failure to look for is a
 *   missing required value. Where `blankRequiredFields` says the write guard in
 *   `handlers/entry-ops.ts` would reject the create before it reaches disk, there is no
 *   finding to make — with the exception of `hidden` fields, which that guard skips.
 * - **"+ Add" in a repeater** — an object-array field gains a blank item. Nothing guards
 *   this path (`addArrayItem` does not consult the required-field check), so a required
 *   key inside the item is a live break.
 */

import type { CheckFinding } from './check'
import type { LoadedCollections } from './check-entries'
import type { ParsedConfig } from './content-config-ast'
import type { LiveSchemas } from './schema-port'

export interface WriteCheckInput {
	config: ParsedConfig
	collections: LoadedCollections
	schemas: LiveSchemas
	/** Injected so a date-defaulted field does not make the report depend on the day it ran. */
	today?: () => Date
}

export function checkEditorWrites(_input: WriteCheckInput): Promise<CheckFinding[]> {
	throw new Error('checkEditorWrites is not implemented yet')
}
