import type { LiveIssue } from '@nuasite/cms-core'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * Every case runs in its own subprocess.
 *
 * The `astro:content` stub `loadLiveSchemas` installs is process-global and irreversible, and the
 * imported config module is cached for the life of the process — so two cases sharing a process
 * would validate the second project against the first project's zod. A subprocess per case is the
 * only honest way to test this; it is also exactly how the CLI uses it. Cases that deliberately
 * load twice pass two jobs to one child.
 *
 * Fixtures live under this package rather than in `/tmp`, so that `astro/zod` resolves to the same
 * Astro the repo installed — except the one case that needs a root with no `node_modules`. They go
 * in `test/temp/.<run>/`: the `temp` segment is already git-ignored repo-wide, and the dot keeps a
 * crashed run's leftovers out of `tsc`'s wildcard include.
 *
 * The children run with `--no-install`: without it, resolving `astro/zod` in a project whose
 * dependencies are missing downloads `astro@latest` from npm instead of failing. Removing that
 * flag would make a regression in `projectAstroDir` cost a few hundred MB per run.
 */

const LIVE_SCHEMA = path.join(import.meta.dir, '..', 'src', 'live-schema.ts')

const DRIVER = `
import { loadLiveSchemas } from ${JSON.stringify(LIVE_SCHEMA)}

const outputs = []
for (const job of JSON.parse(process.argv[2])) {
	const result = await loadLiveSchemas(job.root)
	if ('skipped' in result) {
		outputs.push({ skipped: result.skipped })
		continue
	}
	const parses = []
	for (const probe of job.probes ?? []) {
		const schema = result.schemas[probe.collection]
		parses.push(schema ? await schema.safeParse(probe.value) : { missing: true })
	}
	outputs.push({ collections: Object.keys(result.schemas).sort(), parses })
}
console.log(JSON.stringify(outputs))
`

interface Probe {
	collection: string
	value: unknown
}

interface Job {
	root: string
	probes?: Probe[]
}

type ProbeResult = { success: true } | { success: false; issues: LiveIssue[] } | { missing: true }

interface Outcome {
	skipped?: string
	collections?: string[]
	parses?: ProbeResult[]
}

let workspace: string
let driver: string

async function project(name: string, files: Record<string, string>): Promise<string> {
	const root = path.join(workspace, name)
	await fs.mkdir(root, { recursive: true })
	for (const [relative, contents] of Object.entries(files)) {
		const target = path.join(root, relative)
		await fs.mkdir(path.dirname(target), { recursive: true })
		await fs.writeFile(target, contents)
	}
	return root
}

async function run(jobs: Job[]): Promise<Outcome[]> {
	const child = Bun.spawn([process.execPath, '--no-install', '--conditions=typescript', driver, JSON.stringify(jobs)], {
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 60_000,
	})
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
	if (code !== 0) throw new Error(`driver exited with ${code}\n${stderr}`)
	return JSON.parse(stdout)
}

async function load(root: string, probes: Probe[] = []): Promise<Outcome> {
	const [outcome] = await run([{ root, probes }])
	if (!outcome) throw new Error('the driver produced no outcome')
	return outcome
}

function issuesOf(outcome: Outcome | undefined, index: number): LiveIssue[] {
	const parse = outcome?.parses?.[index]
	if (!parse || !('success' in parse) || parse.success) throw new Error(`probe ${index} was expected to fail: ${JSON.stringify(parse)}`)
	return parse.issues
}

const skippedOf = (outcome: Outcome | undefined): string => {
	if (outcome?.skipped === undefined) throw new Error(`expected a skip, got ${JSON.stringify(outcome).slice(0, 200)}`)
	return outcome.skipped
}

describe('loadLiveSchemas', () => {
	beforeAll(async () => {
		workspace = path.join(import.meta.dir, 'temp', `.live-schema-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(workspace, { recursive: true })
		driver = path.join(workspace, 'driver.ts')
		await fs.writeFile(driver, DRIVER)
	})

	afterAll(async () => {
		await fs.rm(workspace, { recursive: true, force: true })
	})

	test('a project yields schemas that reject a bad value and accept a good one', async () => {
		const root = await project('valid', {
			'src/content.config.ts': `
				import { defineCollection, z } from 'astro:content'

				export const collections = {
					blog: defineCollection({
						schema: ({ image }) => z.object({
							title: z.string().min(3),
							cover: image(),
							slug: z.string().refine(async value => value !== 'reserved', 'slug is reserved'),
							stats: z.array(z.object({ label: z.string() })),
						}),
					}),
					tags: defineCollection({ schema: z.object({ name: z.string() }) }),
					loose: defineCollection({ loader: () => [] }),
				}
			`,
		})

		const good = { title: 'Hello', cover: 'cover.png', slug: 'ok', stats: [{ label: 'a' }] }
		const outcome = await load(root, [
			{ collection: 'blog', value: good },
			{ collection: 'blog', value: { ...good, stats: [{}] } },
			{ collection: 'blog', value: { ...good, title: 'ab' } },
			// An async refinement only resolves under safeParseAsync, which is what Astro itself uses.
			{ collection: 'blog', value: { ...good, slug: 'reserved' } },
			{ collection: 'tags', value: { name: 'x' } },
		])

		// A collection without a schema carries no live opinion, so it is absent rather than always-passing.
		expect(outcome.collections).toEqual(['blog', 'tags'])
		expect(outcome.parses?.[0]).toEqual({ success: true })
		expect(issuesOf(outcome, 1)).toEqual([{ path: ['stats', 0, 'label'], message: expect.any(String) }])
		expect(issuesOf(outcome, 2)[0]?.path).toEqual(['title'])
		expect(issuesOf(outcome, 3)).toEqual([{ path: ['slug'], message: 'slug is reserved' }])
		expect(outcome.parses?.[4]).toEqual({ success: true })
	}, 60_000)

	// Astro's own precedence, and a monorepo's two roots sharing one hoisted Astro install.
	test('the legacy location and the non-.ts extensions are found in Astro order', async () => {
		const legacy = await project('legacy', {
			'src/content/config.ts': `
				import { defineCollection, z } from 'astro:content'
				export const collections = { notes: defineCollection({ schema: z.object({ title: z.string() }) }) }
			`,
		})
		const mixed = await project('mixed-extensions', {
			'src/content.config.mjs': `
				import { defineCollection, z } from 'astro:content'
				export const collections = { fromMjs: defineCollection({ schema: z.object({ title: z.string() }) }) }
			`,
			'src/content.config.ts': `export const collections = { fromTs: { schema: null } }`,
		})

		const [first, second] = await run([{ root: legacy, probes: [{ collection: 'notes', value: { title: 42 } }] }, { root: mixed }])

		expect(first?.collections).toEqual(['notes'])
		expect(issuesOf(first, 0)[0]?.path).toEqual(['title'])
		// `.mjs` is what Astro would load; picking `.ts` here would check a file the build ignores.
		expect(second?.collections).toEqual(['fromMjs'])
	}, 60_000)

	// Astro's reference() takes a lookup object as well as an id string; a narrower stub would report
	// an error on frontmatter that builds, and `checkAgainstSchemas` reports these as errors.
	test('a reference accepts both the id string and the lookup object forms', async () => {
		const root = await project('references', {
			'src/content.config.ts': `
				import { defineCollection, reference, z } from 'astro:content'
				export const collections = {
					blog: defineCollection({ schema: z.object({ author: reference('authors') }) }),
				}
			`,
		})

		const outcome = await load(root, [
			{ collection: 'blog', value: { author: 'jane' } },
			{ collection: 'blog', value: { author: { id: 'jane', collection: 'authors' } } },
			{ collection: 'blog', value: { author: { slug: 'jane', collection: 'authors' } } },
			{ collection: 'blog', value: { author: 7 } },
		])

		expect(outcome.parses?.slice(0, 3)).toEqual([{ success: true }, { success: true }, { success: true }])

		// A union rejection must say what the branches wanted; zod's own wrapper message is "Invalid input".
		const issues = issuesOf(outcome, 3)
		expect(issues.length).toBeGreaterThan(0)
		expect(issues.every(issue => issue.path[0] === 'author')).toBe(true)
		expect(issues.map(issue => issue.message)).toContain('Invalid input: expected string, received number')
		expect(issues.map(issue => issue.message)).not.toContain('Invalid input')
	}, 60_000)

	test('a project with no content config is skipped, not failed', async () => {
		const root = await project('no-config', { 'astro.config.mjs': 'export default {}' })
		const outcome = await load(root)
		expect(skippedOf(outcome)).toContain('src/content.config.ts')
		expect(outcome.collections).toBeUndefined()
	}, 60_000)

	/**
	 * The blocker this guard exists for: `Bun.resolveSync('astro/zod', root)` does not fail on a
	 * project whose dependencies are missing — it downloads astro@latest and resolves into the
	 * install cache, so the check would fetch a few hundred MB and then judge the project's content
	 * with a zod it does not build with.
	 */
	test('a project with no installed astro is skipped without resolving anything', async () => {
		const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'nua-live-schema-'))
		try {
			await fs.mkdir(path.join(outside, 'src'), { recursive: true })
			await fs.writeFile(path.join(outside, 'src/content.config.ts'), `export const collections = {}`)

			const outcome = await load(outside)
			expect(skippedOf(outcome)).toContain('node_modules/astro')
			expect(skippedOf(outcome)).toContain(outside)
		} finally {
			await fs.rm(outside, { recursive: true, force: true })
		}
	}, 60_000)

	test('a malformed or exploding config is skipped, not crashed', async () => {
		const jobs: Job[] = [
			{ root: await project('throws', { 'src/content.config.ts': `throw new Error('config exploded')` }) },
			{ root: await project('no-collections', { 'src/content.config.ts': `export const somethingElse = 1` }) },
			{ root: await project('array-collections', { 'src/content.config.ts': `export const collections = []` }) },
			{ root: await project('not-zod', { 'src/content.config.ts': `export const collections = { broken: { schema: { fields: [] } } }` }) },
			{
				root: await project('factory-throws', {
					'src/content.config.ts': `export const collections = { broken: { schema: () => { throw new Error('factory exploded') } } }`,
				}),
			},
			{
				root: await project('throwing-getter', {
					'src/content.config.ts': `export const collections = { get broken() { throw new Error('getter exploded') } }`,
				}),
			},
		]

		const [importThrows, noCollections, arrayCollections, notZod, factoryThrows, throwingGetter] = await run(jobs)

		expect(skippedOf(importThrows)).toContain('config exploded')
		expect(skippedOf(importThrows)).toContain('content.config.ts')
		expect(skippedOf(noCollections)).toContain('collections')
		expect(skippedOf(arrayCollections)).toContain('collections')
		expect(skippedOf(notZod)).toContain('broken')
		expect(skippedOf(notZod)).toContain('safeParse')
		expect(skippedOf(factoryThrows)).toContain('factory exploded')
		expect(skippedOf(throwingGetter)).toContain('getter exploded')
	}, 60_000)

	// A parse result is project-controlled data: reading it must not be able to reject the promise
	// `checkAgainstSchemas` awaits, or one odd schema takes the whole check down.
	test('a schema whose parse returns nothing usable reports a readable message', async () => {
		const root = await project('odd-parse', {
			'src/content.config.ts': `
				export const collections = {
					odd: { schema: { safeParse: () => 42 } },
					explodes: { schema: { safeParse: () => ({ success: false, get error() { throw new Error('error getter exploded') } }) } },
				}
			`,
		})

		const outcome = await load(root, [
			{ collection: 'odd', value: { anything: true } },
			{ collection: 'explodes', value: { anything: true } },
		])
		expect(issuesOf(outcome, 0)[0]?.message).toBe('the schema returned no parse result')
		expect(issuesOf(outcome, 1)[0]?.message).toBe('error getter exploded')
	}, 60_000)

	// The stub captures one project's zod for the life of the process; a project with its own Astro
	// install must be refused rather than validated against the first one's.
	test('a second project on a different astro install is refused', async () => {
		const first = await project('stub-owner', {
			'src/content.config.ts': `
				import { defineCollection, z } from 'astro:content'
				export const collections = { a: defineCollection({ schema: z.object({ title: z.string() }) }) }
			`,
		})
		const ownZod = Bun.resolveSync('astro/zod', import.meta.dir)
		const other = await project('own-astro', {
			'src/content.config.ts': `
				import { defineCollection, z } from 'astro:content'
				export const collections = { b: defineCollection({ schema: z.object({ title: z.string() }) }) }
			`,
			'node_modules/astro/package.json': JSON.stringify({
				name: 'astro',
				version: '0.0.0-fixture',
				type: 'module',
				exports: { './zod': './zod.js', './package.json': './package.json' },
			}),
			'node_modules/astro/zod.js': `export * from ${JSON.stringify(ownZod)}`,
		})

		const [owner, refused] = await run([{ root: first }, { root: other }])

		expect(owner?.collections).toEqual(['a'])
		expect(skippedOf(refused)).toContain('already loaded')
		expect(skippedOf(refused)).toContain(other)
	}, 60_000)

	// The playground is a real Nua site in this repo: schemas built with `n.*` helpers, not raw zod.
	test('the playground loads against its own astro/zod', async () => {
		const root = path.join(import.meta.dir, '..', '..', 'playground')
		const outcome = await load(root, [
			{ collection: 'tags', value: { name: 'design' } },
			{ collection: 'tags', value: { name: 7 } },
		])

		expect(outcome.collections).toContain('blog')
		expect(outcome.parses?.[0]).toEqual({ success: true })
		expect(issuesOf(outcome, 1)[0]?.path).toEqual(['name'])
	}, 60_000)
})
