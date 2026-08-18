/**
 * The optimistic-concurrency half of an entry editor.
 *
 * `GET …/entries/:slug` exposes no hash, so the first save sends no `baseHash` (the sidecar skips
 * the check) and adopts `MutationResult.sourceHash` as the token; later saves carry it. A `409`
 * hands back the server's version, and the editor offers "use theirs" (adopt the server copy and
 * its hash) or "keep mine" (re-`PATCH` with `baseHash = serverHash`, which force-writes over it).
 *
 * That protocol was implemented twice, line for line — once in `@nuasite/collections-admin`, once
 * in webmaster's collections panel — while everything around it deliberately differed: one editor
 * saves on a debounce, the other on an explicit button. The token handling is contract knowledge
 * and belongs here; *when* to save, what to show while saving and whether to block on a blank
 * required field are the host's calls and stay there.
 *
 * Deliberately not a React hook. Both hosts are React today, but the state here is one string,
 * and a hook would put a UI framework in a package whose whole point is not having one.
 */

import type { FieldDefinition, MutationResult } from '@nuasite/cms-types'
import { type CmsClient, CmsClientError, type CmsConflict } from './client'
import { draftFromServerFrontmatter, type EntryDraft } from './form-model'

/**
 * What a save attempt did. A `409` is an outcome, not an error — the editor has a dialog for it.
 * Anything else that fails arrives as `error` with a message already fit to show; `cause` carries
 * the original for hosts that want to distinguish e.g. an expired session.
 */
export type EntrySaveOutcome =
	| { status: 'saved'; result: MutationResult }
	| { status: 'conflict'; conflict: CmsConflict }
	| { status: 'error'; message: string; cause: unknown }

export interface EntrySaver {
	/** The current optimistic-concurrency token — `undefined` until the first successful save. */
	readonly baseHash: string | undefined
	/** `PATCH` the draft with the token held. */
	save(draft: EntryDraft): Promise<EntrySaveOutcome>
	/** Re-`PATCH` over a conflict, keeping the local draft and discarding the server's version. */
	overwrite(draft: EntryDraft, conflict: CmsConflict): Promise<EntrySaveOutcome>
	/** Adopt the server's version: returns the draft to show and takes on the server's hash. */
	adoptServer(conflict: CmsConflict, fields: FieldDefinition[]): EntryDraft
	/** Forget the token — the editor moved to another entry, or reloaded this one. */
	reset(): void
}

/** A saver for one `collection`/`slug`. Create a new one when the editor opens another entry. */
export function createEntrySaver(client: Pick<CmsClient, 'updateEntry'>, collection: string, slug: string): EntrySaver {
	let baseHash: string | undefined

	async function patch(draft: EntryDraft, hash: string | undefined): Promise<EntrySaveOutcome> {
		try {
			const outcome = await client.updateEntry(collection, slug, { frontmatter: draft.frontmatter, body: draft.body, baseHash: hash })
			if (outcome.status === 'conflict') return { status: 'conflict', conflict: outcome.conflict }
			// A sidecar that returns no hash leaves the previous one in place rather than
			// clearing it: dropping the token would silently turn the next save into a force-write.
			if (outcome.result.sourceHash !== undefined) baseHash = outcome.result.sourceHash
			return { status: 'saved', result: outcome.result }
		} catch (cause: unknown) {
			return { status: 'error', message: cause instanceof CmsClientError ? cause.message : 'Save failed', cause }
		}
	}

	return {
		get baseHash() {
			return baseHash
		},
		save: draft => patch(draft, baseHash),
		overwrite: (draft, conflict) => patch(draft, conflict.serverHash),
		adoptServer: (conflict, fields) => {
			baseHash = conflict.serverHash
			return draftFromServerFrontmatter(conflict.serverFrontmatter, conflict.serverBody, fields)
		},
		reset: () => {
			baseHash = undefined
		},
	}
}
