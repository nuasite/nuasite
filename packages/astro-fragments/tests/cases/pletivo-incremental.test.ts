import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FragmentManifest } from '../../src/manifest.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.resolve(here, '../fixtures/basic')
const distDir = path.join(fixtureRoot, 'dist')
const fragmentsDir = path.join(distDir, '_fragments')
const cacheDir = path.join(fixtureRoot, '.pletivo')

// The pletivo CLI ships as TypeScript next to its entry point and runs on Bun.
const pletivoCli = path.join(path.dirname(fileURLToPath(import.meta.resolve('pletivo'))), 'cli.ts')

async function readManifest(): Promise<FragmentManifest> {
	const raw = await fs.readFile(path.join(fragmentsDir, 'manifest.json'), 'utf8')
	return JSON.parse(raw) as FragmentManifest
}

function runPletivoBuild(args: string[] = []): { stdout: string; stderr: string; status: number } {
	const result = spawnSync(process.execPath, [pletivoCli, 'build', '--incremental', ...args], {
		cwd: fixtureRoot,
		encoding: 'utf8',
		env: { ...process.env, NODE_ENV: 'production' },
	})
	return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? -1 }
}

async function cleanWorkspace(): Promise<void> {
	await fs.rm(distDir, { recursive: true, force: true })
	await fs.rm(cacheDir, { recursive: true, force: true })
}

const BUILD_TIMEOUT = 60_000

describe('e2e: pletivo incremental build with fragments', () => {
	beforeAll(async () => {
		await cleanWorkspace()
	})

	afterAll(async () => {
		await cleanWorkspace()
	})

	it('cold build → second build reuses every page and re-renders every fragment', async () => {
		const first = runPletivoBuild()
		expect(first.status).toBe(0)
		expect(first.stdout).toMatch(/4 rendered \+ 0 cached/)

		const firstManifest = await readManifest()
		const firstFragmentIds = Object.keys(firstManifest.fragments).sort()
		expect(firstFragmentIds.length).toBe(4)

		const beforeContents = new Map<string, string>()
		for (const id of firstFragmentIds) {
			const entry = firstManifest.fragments[id]
			if (!entry) throw new Error(`missing manifest entry for ${id}`)
			beforeContents.set(id, await fs.readFile(path.join(distDir, entry.file), 'utf8'))
		}

		const second = runPletivoBuild()
		expect(second.status).toBe(0)
		expect(second.stdout).toMatch(/0 rendered \+ 4 cached/)
		// Pages come from the cache, but their replayed fragments are rendered
		// again: the fragments' own data reads are not part of the page's cache key.
		expect(second.stdout).toMatch(/rendered 4 fragment\(s\) into _fragments\//)

		const secondManifest = await readManifest()
		expect(secondManifest.fragments).toEqual(firstManifest.fragments)
		for (const id of firstFragmentIds) {
			const after = await fs.readFile(path.join(distDir, `_fragments/${id}.html`), 'utf8')
			expect(after).toBe(beforeContents.get(id) ?? '')
		}
	}, BUILD_TIMEOUT)

	it('fragment manifest stays well-formed across rebuilds (no version drift)', async () => {
		const manifest = await readManifest()
		expect(manifest.version).toBe(1)
		expect(manifest.outputDir).toBe('_fragments')
		for (const entry of Object.values(manifest.fragments)) {
			expect(entry.moduleId.startsWith('/')).toBe(false)
			expect(entry.id).toMatch(/^[a-f0-9]{12}$/)
		}
	})
})
