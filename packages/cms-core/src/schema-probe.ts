/**
 * Ask a live schema what it thinks of one field, without the rest of the record answering for it.
 *
 * The static rules read the config's source and the live rules read the schema's verdict on a
 * whole entry. Neither can say what the schema believes about a *single* field, which is what the
 * drift rules need: whether it insists on the key, whether it would take text there.
 *
 * The technique is the same for every question. Start from an entry the schema already accepts,
 * change exactly one value, parse again, and look at where the issues land. Starting from an
 * accepted entry is what makes the answer attributable — on a record the schema already rejects,
 * every probe comes back "rejected" and means nothing. Reading the issue's *path* rather than
 * overall success is the other half: a schema with a cross-field refinement can fail for reasons
 * that have nothing to do with the field being probed.
 *
 * Every function here is total. A schema that throws answers "I don't know", which callers read
 * as "report nothing" — a rule that cannot get evidence has to stay quiet rather than guess.
 */

import type { LoadedEntry } from './check-entries'
import type { LiveSchema } from './schema-port'

/** One field in one record: the accepted entry to start from, and where the field sits in it. */
export interface ProbePoint {
	/** Never mutated — every probe works on a clone. */
	record: Record<string, unknown>
	path: (string | number)[]
}

/** The point for a top-level field of `seed`. The probe sets the key, so the seed need not already carry it. */
export const pointAt = (seed: Record<string, unknown>, field: string): ProbePoint => ({ record: seed, path: [field] })

/**
 * Values chosen so that no realistic schema accepts all four.
 *
 * They answer one question: does the schema have an opinion about this path at all? A field the
 * parser invented, or one landing in a `passthrough()`/`catchall()` object, accepts anything and
 * must not be reported — a rule firing on a field the schema never governs is a false positive on
 * a project that is fine.
 */
const GOVERNANCE_PROBES: unknown[] = [{ __nuaProbe: true }, ['__nua_probe__'], 918_273.456, null]

type Mutation = { set: unknown } | { remove: true }

const isContainer = (value: unknown): value is Record<string | number, unknown> => typeof value === 'object' && value !== null

/** A copy of the record with one value changed, or `null` when it cannot be built. */
function mutated(point: ProbePoint, mutation: Mutation): Record<string, unknown> | null {
	let copy: Record<string, unknown>
	try {
		copy = structuredClone(point.record)
	} catch {
		// Frontmatter is plain data, so this should not happen — but an unclonable value must cost
		// this one probe, not the run.
		return null
	}

	let parent: unknown = copy
	for (const segment of point.path.slice(0, -1)) {
		if (!isContainer(parent)) return null
		parent = parent[segment]
	}
	const last = point.path.at(-1)
	if (last === undefined || !isContainer(parent)) return null

	if ('remove' in mutation) delete parent[last]
	else parent[last] = mutation.set
	return copy
}

/** What one probe learned. `unknown` is a schema that threw, or a record that could not be built. */
type ProbeVerdict = 'accepted' | 'rejected-here' | 'rejected-elsewhere' | 'unknown'

async function probe(schema: LiveSchema, point: ProbePoint, mutation: Mutation): Promise<ProbeVerdict> {
	const value = mutated(point, mutation)
	if (value === null) return 'unknown'
	try {
		const result = await schema.safeParse(value)
		if (result.success) return 'accepted'
		const here = result.issues.some(issue => point.path.every((segment, index) => issue.path[index] === segment))
		return here ? 'rejected-here' : 'rejected-elsewhere'
	} catch {
		return 'unknown'
	}
}

/**
 * Whether the schema constrains this path at all.
 *
 * True as soon as one probe value is refused *at the path*. False means either a schema that takes
 * anything here or one that could not be asked; both are reasons to report nothing.
 */
export async function governsPath(schema: LiveSchema, point: ProbePoint): Promise<boolean> {
	for (const value of GOVERNANCE_PROBES) {
		if (await probe(schema, point, { set: value }) === 'rejected-here') return true
	}
	return false
}

/**
 * Whether the schema takes the record with this key removed.
 *
 * Deliberately strict — the whole record has to parse, not merely avoid an issue at this path. The
 * claim built on it is that the editor blocks a save the build would accept, and a record failing
 * elsewhere is not evidence the build would accept anything.
 */
export async function acceptsMissing(schema: LiveSchema, point: ProbePoint): Promise<boolean> {
	return await probe(schema, point, { remove: true }) === 'accepted'
}

/** Whether the schema refuses `value` *at this path*, as opposed to failing for some unrelated reason. */
export async function rejectsValueAt(schema: LiveSchema, point: ProbePoint, value: unknown): Promise<boolean> {
	return await probe(schema, point, { set: value }) === 'rejected-here'
}

/**
 * The first entry the schema accepts, or `undefined` when there is none.
 *
 * Shared with the write check so both mean the same thing by "a record the editor is really
 * sitting on". Seeding from a rejected entry would blame every probe for that entry's own
 * problems, which `check-live.ts` already reports.
 */
export async function firstAcceptedEntry(schema: LiveSchema, entries: LoadedEntry[]): Promise<Record<string, unknown> | undefined> {
	for (const entry of entries) {
		if (!entry.frontmatter) continue
		try {
			const result = await schema.safeParse(entry.frontmatter)
			if (result.success) return entry.frontmatter
		} catch {
			// A schema that throws on an entry has not accepted it; `check-live.ts` reports the throw.
		}
	}
	return undefined
}
