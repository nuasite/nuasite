import {
	checkAgainstSchemas,
	type LiveCheckInput,
	type LiveIssue,
	type LiveSchema,
	type LiveSchemas,
	type LoadedCollections,
	type LoadedEntry,
	type ParsedConfig,
} from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A hand-written stand-in for a compiled zod schema.
 *
 * Deliberately fake: this file pins down what the checker does with a verdict, not what zod
 * produces. Loading a project's real schema is the CLI's job and is covered there.
 */
const schemaOf = (rule: (value: unknown) => LiveIssue[], delayFor: (value: unknown) => number = () => 0): LiveSchema => ({
	safeParse: async value => {
		// Astro validates with `safeParseAsync`, so a schema may genuinely resolve on a later tick.
		const delayMs = delayFor(value)
		if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
		const issues = rule(value)
		return issues.length === 0 ? { success: true } : { success: false, issues }
	},
})

const rejectsWith = (...issues: LiveIssue[]): LiveSchema => schemaOf(() => issues)
const accepts = (): LiveSchema => schemaOf(() => [])

/** Frontmatter omitted means the file did not parse — the shape `loadCollections` produces. */
const entryOf = (file: string, frontmatter?: Record<string, unknown>): LoadedEntry => ({
	file,
	stem: file.replace(/^.*\//, '').replace(/\.md$/, ''),
	...(frontmatter === undefined ? { parseError: 'frontmatter is never closed (missing the second `---`)' } : { frontmatter }),
})

const inputOf = (collections: Record<string, LoadedEntry[]>, schemas: LiveSchemas): LiveCheckInput => {
	const config: ParsedConfig = new Map()
	const loaded: LoadedCollections = new Map()
	for (const [name, entries] of Object.entries(collections)) {
		config.set(name, { name, fields: [], loaderBase: `./src/content/${name}` })
		loaded.set(name, { name, base: `src/content/${name}`, exists: true, entries })
	}
	return { config, collections: loaded, schemas }
}

// The AST rules in `check.ts` say nothing about a plain `z.string()`. These rules do: whatever
// the project's real schema rejects is what the build will reject.
describe('checkAgainstSchemas', () => {
	test('a value the schema rejects becomes an error naming the field', async () => {
		const input = inputOf(
			{ people: [entryOf('src/content/people/ada.md', { order: '' })] },
			{
				people: schemaOf(value => (isRecord(value) && value.order === '' ? [{ path: ['order'], message: 'Expected number, received string' }] : [])),
			},
		)

		expect(await checkAgainstSchemas(input)).toStrictEqual([{
			severity: 'error',
			code: 'entry/schema-rejected',
			file: 'src/content/people/ada.md',
			field: 'order',
			message: 'order: Expected number, received string',
		}])
	})

	test('a nested path becomes a dotted field', async () => {
		const input = inputOf(
			{ people: [entryOf('src/content/people/ada.md', { stats: [{ label: 1 }] })] },
			{ people: rejectsWith({ path: ['stats', 0, 'label'], message: 'Expected string, received number' }) },
		)

		const findings = await checkAgainstSchemas(input)
		expect(findings).toHaveLength(1)
		expect(findings[0]!.field).toBe('stats.0.label')
		expect(findings[0]!.message).toBe('stats.0.label: Expected string, received number')
	})

	test('an issue about the entry itself carries no field', async () => {
		const input = inputOf(
			{ people: [entryOf('src/content/people/ada.md', { titel: 'Ada' })] },
			{ people: rejectsWith({ path: [], message: 'Unrecognized key: "titel"' }) },
		)

		const findings = await checkAgainstSchemas(input)
		expect(findings).toHaveLength(1)
		// Omitted, not set to undefined — `toEqual`/`toBeUndefined` cannot tell those apart.
		expect('field' in findings[0]!).toBe(false)
		expect(findings[0]!.message).toBe('Unrecognized key: "titel"')
	})

	// Reporting the whole entry in one pass is the reason `nua check` exists — `astro sync`
	// aborts on the first bad value.
	test('every issue on one entry surfaces, in the order the schema reported them', async () => {
		const input = inputOf(
			{ people: [entryOf('src/content/people/petra.md', { order: '', orderTym: '' })] },
			{
				people: rejectsWith(
					{ path: ['order'], message: 'Expected number, received string' },
					{ path: ['orderTym'], message: 'Expected number, received string' },
					{ path: ['name'], message: 'Required' },
				),
			},
		)

		expect((await checkAgainstSchemas(input)).map(finding => finding.field)).toEqual(['order', 'orderTym', 'name'])
	})

	test('an entry whose frontmatter did not parse is skipped, not handed to the schema', async () => {
		const seen: unknown[] = []
		const input = inputOf(
			{ people: [entryOf('src/content/people/broken.md'), entryOf('src/content/people/ada.md', { name: 'Ada' })] },
			{
				people: schemaOf(value => {
					seen.push(value)
					return []
				}),
			},
		)

		expect(await checkAgainstSchemas(input)).toEqual([])
		expect(seen).toEqual([{ name: 'Ada' }])
	})

	// One bad schema must cost one finding, not the whole report — `checkContent` awaits this,
	// so a throw here would also discard every static finding already collected.
	test('a schema that throws becomes an error, and the rest of the run continues', async () => {
		const input = inputOf(
			{
				people: [
					entryOf('src/content/people/ada.md', { name: 'Ada' }),
					entryOf('src/content/people/petra.md', { name: 'Petra' }),
					entryOf('src/content/people/zoe.md', { name: 'Zoe' }),
				],
			},
			{
				people: schemaOf(value => {
					if (isRecord(value) && value.name === 'Petra') throw new Error('Cannot read properties of undefined (reading "shape")')
					return [{ path: ['order'], message: 'Required' }]
				}),
			},
		)

		const findings = await checkAgainstSchemas(input)
		expect(findings.map(finding => finding.file)).toEqual([
			'src/content/people/ada.md',
			'src/content/people/petra.md',
			'src/content/people/zoe.md',
		])
		expect(findings[1]!.severity).toBe('error')
		expect(findings[1]!.code).toBe('entry/schema-rejected')
		expect('field' in findings[1]!).toBe(false)
		expect(findings[1]!.message).toBe(
			'The collection schema threw while validating this entry: Cannot read properties of undefined (reading "shape")',
		)
	})

	test('a collection with no live schema is skipped', async () => {
		const input = inputOf(
			{
				people: [entryOf('src/content/people/ada.md', { order: '' })],
				articles: [entryOf('src/content/articles/one.md', { title: 1 })],
			},
			{ articles: rejectsWith({ path: ['title'], message: 'Expected string, received number' }) },
		)

		expect((await checkAgainstSchemas(input)).map(finding => finding.file)).toEqual(['src/content/articles/one.md'])
	})

	test('a collection the schema accepts reports nothing', async () => {
		const input = inputOf(
			{ people: [entryOf('src/content/people/ada.md', { name: 'Ada', order: 1 })] },
			{ people: accepts() },
		)

		expect(await checkAgainstSchemas(input)).toEqual([])
	})

	// A slow parse must not overtake a fast one — the report has to read the same every run.
	// The delay is per entry on purpose: the first entry of `people` is the slowest thing in
	// the run, so parsing a collection's entries concurrently and pushing as they land reorders
	// the output and fails here.
	test('findings come out in collection order, then entry order', async () => {
		const input = inputOf(
			{
				people: [
					entryOf('src/content/people/ada.md', { slow: true }),
					entryOf('src/content/people/petra.md', {}),
				],
				articles: [entryOf('src/content/articles/one.md', {})],
			},
			{
				people: schemaOf(
					() => [{ path: ['name'], message: 'Required' }],
					value => (isRecord(value) && value.slow === true ? 20 : 0),
				),
				articles: rejectsWith({ path: ['title'], message: 'Required' }),
			},
		)

		expect((await checkAgainstSchemas(input)).map(finding => finding.file)).toEqual([
			'src/content/people/ada.md',
			'src/content/people/petra.md',
			'src/content/articles/one.md',
		])
	})
})
