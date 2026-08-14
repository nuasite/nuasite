import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { astroRoots, check, type CheckOptions, parseCheckArgs } from '../src/check'

// Running the check at a monorepo root has to work: that is where an agent's workspace starts,
// and `bun run build` there builds admin/api/worker instead of the site — which is exactly how
// an agent spent a session "verifying" builds that never touched the pages it had edited.
describe('astroRoots', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__roots-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	const touch = async (relative: string) => {
		const target = path.join(root, relative)
		await fs.mkdir(path.dirname(target), { recursive: true })
		await fs.writeFile(target, '')
	}

	test('a flat site is the root itself', async () => {
		await touch('astro.config.mjs')
		expect(astroRoots(root)).toEqual(['.'])
	})

	test.each(['astro.config.ts', 'astro.config.mts', 'astro.config.mjs', 'astro.config.js'])('%s counts', async (name) => {
		await touch(name)
		expect(astroRoots(root)).toEqual(['.'])
	})

	test('a monorepo resolves to the package that holds the config', async () => {
		await touch('package.json')
		await touch('packages/api/package.json')
		await touch('packages/worker/package.json')
		await touch('packages/web/astro.config.mjs')
		expect(astroRoots(root)).toEqual([path.join('packages', 'web')])
	})

	// One of two sites silently skipped is worse than a slower check.
	test('every astro package is returned, not just the first', async () => {
		await touch('packages/web/astro.config.mjs')
		await touch('packages/docs/astro.config.ts')
		expect(astroRoots(root)).toEqual([path.join('packages', 'docs'), path.join('packages', 'web')])
	})

	test('the root wins when it is itself an astro project', async () => {
		await touch('astro.config.mjs')
		await touch('packages/web/astro.config.mjs')
		expect(astroRoots(root)).toEqual(['.'])
	})

	test('a repo with no astro project resolves to nothing', async () => {
		await touch('package.json')
		await touch('packages/api/package.json')
		expect(astroRoots(root)).toEqual([])
	})
})

describe('parseCheckArgs', () => {
	test('no flags: everything off, live rules on', () => {
		expect(parseCheckArgs([], '/repo')).toEqual({ cwd: '/repo', json: false, strict: false, contentOnly: false, live: true })
	})

	test('each flag is read independently', () => {
		expect(parseCheckArgs(['--json', '--strict'], '/repo')).toMatchObject({ json: true, strict: true, contentOnly: false, live: true })
	})

	// Loading the real schemas runs the project's content config — the opposite of "do not look at code".
	test('--content-only implies no live rules', () => {
		expect(parseCheckArgs(['--content-only'], '/repo')).toMatchObject({ contentOnly: true, live: false })
	})

	test('--no-live turns the live rules off on their own', () => {
		expect(parseCheckArgs(['--no-live'], '/repo')).toMatchObject({ contentOnly: false, live: false })
	})

	test('both together stay consistent', () => {
		expect(parseCheckArgs(['--content-only', '--no-live', '--json'], '/repo')).toMatchObject({ contentOnly: true, live: false, json: true })
	})

	test('an unknown flag changes nothing', () => {
		expect(parseCheckArgs(['--live', '-x'], '/repo')).toMatchObject({ json: false, strict: false, contentOnly: false, live: true })
	})
})

// A check that did not run must not read as a pass — and in --json the reason has to travel
// inside the payload, because a stray line breaks every consumer parsing the output.
describe('check reports whether the live rules ran', () => {
	let workspace: string

	beforeAll(async () => {
		workspace = path.join(import.meta.dir, `.check-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(workspace, { recursive: true })
	})

	afterAll(async () => {
		await fs.rm(workspace, { recursive: true, force: true })
	})

	async function project(name: string, files: Record<string, string>): Promise<string> {
		const root = path.join(workspace, name)
		for (const [relative, contents] of Object.entries(files)) {
			const target = path.join(root, relative)
			await fs.mkdir(path.dirname(target), { recursive: true })
			await fs.writeFile(target, contents)
		}
		return root
	}

	const CONFIG = `
		import { defineCollection, z } from 'astro:content'
		export const collections = { blog: defineCollection({ schema: z.object({ title: z.string() }) }) }
	`

	async function run(options: CheckOptions): Promise<{ code: number; out: string }> {
		const lines: string[] = []
		const original = console.log
		console.log = (...args: unknown[]) => {
			lines.push(args.join(' '))
		}
		try {
			const code = await check(options)
			return { code, out: lines.join('\n') }
		} finally {
			console.log = original
		}
	}

	const twoSites = {
		'packages/docs/astro.config.mjs': 'export default {}',
		'packages/docs/src/content.config.ts': CONFIG,
		'packages/web/astro.config.mjs': 'export default {}',
		'packages/web/src/content.config.ts': CONFIG,
	}

	test('--json stays one document, with the skip reason inside it', async () => {
		const cwd = await project('two-sites', twoSites)

		const { out } = await run({ cwd, json: true, strict: false, contentOnly: false, live: true })
		const payload: unknown = JSON.parse(out)
		expect(payload).toMatchObject({ liveSchemas: expect.stringContaining('exactly one Astro project') })
		expect(out.trimEnd().endsWith('}')).toBe(true)
	})

	test('a multi-root run says the live rules were skipped', async () => {
		const cwd = await project('two-sites-human', twoSites)

		const { out } = await run({ cwd, json: false, strict: false, contentOnly: false, live: true })
		expect(out).toContain('Live schema rules did not run:')
		expect(out).toContain(path.join('packages', 'web'))
	})

	test('--content-only names itself as the reason', async () => {
		const cwd = await project('content-only', {
			'astro.config.mjs': 'export default {}',
			'src/content.config.ts': CONFIG,
		})

		const { out } = await run({ cwd, json: true, strict: false, contentOnly: true, live: false })
		expect(JSON.parse(out)).toMatchObject({ liveSchemas: expect.stringContaining('--content-only') })
	})

	test('--no-live names itself as the reason', async () => {
		const cwd = await project('no-live', {
			'astro.config.mjs': 'export default {}',
			'src/content.config.ts': CONFIG,
		})

		const { out } = await run({ cwd, json: true, strict: false, contentOnly: false, live: false })
		expect(JSON.parse(out)).toMatchObject({ liveSchemas: expect.stringContaining('--no-live') })
	})

	// The loader's own sentence has to survive to the user: it is the one that says what to fix.
	test("the loader's skip reason reaches the payload", async () => {
		const cwd = await project('no-content-config', { 'astro.config.mjs': 'export default {}' })

		const { out } = await run({ cwd, json: true, strict: false, contentOnly: false, live: true })
		expect(JSON.parse(out)).toMatchObject({ liveSchemas: expect.stringContaining('src/content.config.ts') })
	})
})

/**
 * The playground is a real Nua site in this repo, so this is the closest thing to end-to-end.
 *
 * It runs in a subprocess because loading live schemas installs a process-global `astro:content`
 * stub that cannot be undone — the same reason the CLI only does it for a single root.
 */
describe('nua check on the playground', () => {
	const playground = path.join(import.meta.dir, '..', '..', 'playground')
	const cli = path.join(import.meta.dir, '..', 'src', 'index.ts')

	test('--json is a single document reporting that the live rules ran', async () => {
		const child = Bun.spawn(['bun', '--conditions=typescript', cli, 'check', '--json'], { cwd: playground, stdout: 'pipe', stderr: 'pipe' })
		const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
		const exit = await child.exited
		// Without this an empty stdout fails as an opaque JSON parse error, hiding the crash that caused it.
		if (stdout.trim() === '') throw new Error(`nua check printed nothing (exit ${exit}):\n${stderr}`)

		const payload: unknown = JSON.parse(stdout)
		expect(payload).toMatchObject({ liveSchemas: 'ran', roots: ['.'] })
	}, 60_000)
})
