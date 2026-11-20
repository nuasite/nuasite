import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { astroRoots, check, type CheckOptions, CheckUsageError, parseCheckArgs } from '../src/check'

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
		expect(parseCheckArgs([], '/repo')).toEqual({ cwd: '/repo', json: false, strict: false, contentOnly: false, live: true, failOn: null, files: null })
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

	test('--fail-on takes a comma-separated list, as the next argument or after =', () => {
		expect(parseCheckArgs(['--fail-on', 'src/a.css,./src/pages/index.astro'], '/repo').failOn).toEqual(['src/a.css', 'src/pages/index.astro'])
		expect(parseCheckArgs(['--fail-on=src/a.css', '--json'], '/repo')).toMatchObject({ failOn: ['src/a.css'], json: true })
		expect(parseCheckArgs(['--fail-on='], '/repo').failOn).toEqual([])
	})

	// Taking the next flag as the list, or nothing, would check none of the files meant and still pass.
	test('a list flag without its value is refused', () => {
		expect(() => parseCheckArgs(['--fail-on'], '/repo')).toThrow(CheckUsageError)
		expect(() => parseCheckArgs(['--files', '--json'], '/repo')).toThrow(CheckUsageError)
	})

	test('--files takes a list the same way, independently of --fail-on', () => {
		expect(parseCheckArgs(['--files', 'src/a.astro,./src/b.ts'], '/repo')).toMatchObject({ files: ['src/a.astro', 'src/b.ts'], failOn: null })
		expect(parseCheckArgs(['--files=src/a.astro', '--fail-on=src/b.ts'], '/repo')).toMatchObject({ files: ['src/a.astro'], failOn: ['src/b.ts'] })
		expect(parseCheckArgs(['--json'], '/repo').files).toBeNull()
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

		const { out } = await run({ cwd, json: true, strict: false, contentOnly: false, live: true, failOn: null, files: null })
		const payload: unknown = JSON.parse(out)
		expect(payload).toMatchObject({ liveSchemas: expect.stringContaining('exactly one Astro project') })
		expect(out.trimEnd().endsWith('}')).toBe(true)
	})

	test('a multi-root run says the live rules were skipped', async () => {
		const cwd = await project('two-sites-human', twoSites)

		const { out } = await run({ cwd, json: false, strict: false, contentOnly: false, live: true, failOn: null, files: null })
		expect(out).toContain('Live schema rules did not run:')
		expect(out).toContain(path.join('packages', 'web'))
	})

	test('--content-only names itself as the reason', async () => {
		const cwd = await project('content-only', {
			'astro.config.mjs': 'export default {}',
			'src/content.config.ts': CONFIG,
		})

		const { out } = await run({ cwd, json: true, strict: false, contentOnly: true, live: false, failOn: null, files: null })
		expect(JSON.parse(out)).toMatchObject({ liveSchemas: expect.stringContaining('--content-only') })
	})

	test('--no-live names itself as the reason', async () => {
		const cwd = await project('no-live', {
			'astro.config.mjs': 'export default {}',
			'src/content.config.ts': CONFIG,
		})

		const { out } = await run({ cwd, json: true, strict: false, contentOnly: false, live: false, failOn: null, files: null })
		expect(JSON.parse(out)).toMatchObject({ liveSchemas: expect.stringContaining('--no-live') })
	})

	// The loader's own sentence has to survive to the user: it is the one that says what to fix.
	test("the loader's skip reason reaches the payload", async () => {
		const cwd = await project('no-content-config', { 'astro.config.mjs': 'export default {}' })

		const { out } = await run({ cwd, json: true, strict: false, contentOnly: false, live: true, failOn: null, files: null })
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

// A commit runs the check on the files it changes: an error there stops it, one it did not touch does not.
describe('check --fail-on', () => {
	let workspace: string

	beforeAll(async () => {
		workspace = path.join(import.meta.dir, `.fail-on-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		await fs.mkdir(workspace, { recursive: true })
		await fs.writeFile(path.join(workspace, 'astro.config.mjs'), 'export default {}')
		await fs.mkdir(path.join(workspace, 'src/styles'), { recursive: true })
		await fs.writeFile(path.join(workspace, 'src/styles/old.css'), '.a { color: red;\n')
		await fs.writeFile(path.join(workspace, 'src/styles/new.css'), '.b { color: blue; }\n')
	})

	afterAll(async () => {
		await fs.rm(workspace, { recursive: true, force: true })
	})

	const options = (failOn: string[] | null): CheckOptions => ({
		cwd: workspace,
		json: false,
		strict: false,
		contentOnly: true,
		live: false,
		failOn,
		files: null,
	})

	async function quiet(run: () => Promise<number>): Promise<number> {
		const original = console.log
		console.log = () => {}
		try {
			return await run()
		} finally {
			console.log = original
		}
	}

	test('without it, any error fails', async () => {
		expect(await quiet(() => check({ ...options(null), contentOnly: false }))).toBe(1)
	})

	test('an error only in a file not listed is reported but does not fail', async () => {
		expect(await quiet(() => check({ ...options(['src/styles/new.css']), contentOnly: false }))).toBe(0)
	})

	test('an error in a listed file fails', async () => {
		expect(await quiet(() => check({ ...options(['src/styles/new.css', 'src/styles/old.css']), contentOnly: false }))).toBe(1)
	})

	test('a listed source file the run did not parse is named, not passed over in silence', async () => {
		const lines: string[] = []
		const original = console.log
		console.log = (...args: unknown[]) => lines.push(args.join(' '))
		try {
			const code = await check({
				...options(['src/styles/new.css', 'packages/shared/x.css', 'public/vendor.css', 'src/scripts/menu.js']),
				contentOnly: false,
			})
			expect(code).toBe(0)
		} finally {
			console.log = original
		}
		expect(lines.join('\n')).toContain('No errors in the 1 file(s) given to --fail-on that were checked.')
		expect(lines.join('\n')).toContain(
			'Not parsed by this run (a content entry is still checked with its collection): packages/shared/x.css, public/vendor.css, src/scripts/menu.js',
		)
	})

	test('a file listed by its absolute path counts as listed', async () => {
		expect(await quiet(() => check({ ...options([path.join(workspace, 'src/styles/old.css')]), contentOnly: false }))).toBe(1)
	})
})

// A change that must not add a broken file is checked on what it touched: on a large site, parsing every file
// is the slow part of the check.
describe('check --files', () => {
	let workspace: string

	// An attribute expression left open swallows the `<style>` and `<script>` below it. Astro's parser reports
	// nothing; the emitted code does not parse, and the build stops on it.
	const OPEN_ATTRIBUTE_EXPRESSION = [
		'---',
		'const open = false',
		'---',
		'<header class={open>Menu</header>',
		'<style>',
		'  [data-panel] details[open] > summary { transform: rotate(180deg); }',
		'</style>',
		'<script>',
		"  const panel = document.querySelector<HTMLElement>('[data-panel]')",
		'</script>',
		'',
	].join('\n')

	beforeAll(async () => {
		workspace = path.join(import.meta.dir, `.files-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		const write = async (relative: string, contents: string) => {
			await fs.mkdir(path.dirname(path.join(workspace, relative)), { recursive: true })
			await fs.writeFile(path.join(workspace, relative), contents)
		}
		await write('packages/web/astro.config.mjs', 'export default {}')
		await write('packages/web/src/content.config.ts', 'export const collections = {}\n')
		await write('packages/web/src/components/Header.astro', OPEN_ATTRIBUTE_EXPRESSION)
		await write('packages/web/src/components/Footer.astro', '<footer>ok</footer>\n')
	})

	afterAll(async () => {
		await fs.rm(workspace, { recursive: true, force: true })
	})

	interface Report {
		findings: { code: string; file: string; line?: number }[]
		filesUnchecked?: string[]
	}

	async function run(files: string[] | null): Promise<{ code: number; report: Report }> {
		const lines: string[] = []
		const original = console.log
		console.log = (...args: unknown[]) => lines.push(args.join(' '))
		try {
			const code = await check({ cwd: workspace, json: true, strict: false, contentOnly: false, live: false, failOn: null, files })
			const report: Report = JSON.parse(lines.join('\n'))
			return { code, report }
		} finally {
			console.log = original
		}
	}

	async function report(files: string[] | null): Promise<{ code: number; findings: Report['findings'] }> {
		const { code, report } = await run(files)
		return { code, findings: report.findings }
	}

	test('a broken file that is not listed is not parsed', async () => {
		expect(await report(['packages/web/src/components/Footer.astro'])).toEqual({ code: 0, findings: [] })
	})

	test('a listed file is parsed in its own Astro project, and its error named at the source line', async () => {
		const { code, findings } = await report(['packages/web/src/components/Header.astro', 'packages/web/src/components/Footer.astro'])
		expect(code).toBe(1)
		expect(findings).toMatchObject([{ code: 'code/syntax', file: path.join('packages', 'web', 'src', 'components', 'Header.astro'), line: 4 }])
	})

	test('an empty list parses nothing', async () => {
		expect(await report([])).toEqual({ code: 0, findings: [] })
	})

	test('a file listed by its absolute path is parsed', async () => {
		const { code, findings } = await report([path.join(workspace, 'packages/web/src/components/Header.astro')])
		expect(code).toBe(1)
		expect(findings.map(finding => finding.code)).toEqual(['code/syntax'])
	})

	// A gate that passes because it parsed nothing must say so: a typo, or a path relative to the site run from the root.
	test('a listed file that was not parsed is named, without --fail-on too', async () => {
		const { code, report } = await run(['packages/web/src/components/Headr.astro', 'src/components/Header.astro'])
		expect(code).toBe(0)
		expect(report.filesUnchecked).toEqual([
			path.join('packages', 'web', 'src', 'components', 'Headr.astro'),
			path.join('src', 'components', 'Header.astro'),
		])
	})

	test('without it every source file is parsed', async () => {
		expect((await report(null)).findings.map(finding => finding.file)).toEqual([path.join('packages', 'web', 'src', 'components', 'Header.astro')])
	})
})
