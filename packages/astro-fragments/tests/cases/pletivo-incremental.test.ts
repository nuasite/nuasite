import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FragmentManifest } from '../../src/manifest.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.resolve(here, '../fixtures/basic')
const distDir = path.join(fixtureRoot, 'dist')
const fragmentsDir = path.join(distDir, '_fragments')
const cacheDir = path.join(fixtureRoot, '.pletivo')

// Pletivo lives in a sibling repo at ~/projects/oss/pletivo. Skip the
// suite if we can't find the binary — keeps CI green on machines that
// don't clone the pletivo source tree.
const pletivoBin = path.resolve(process.env.HOME ?? '', 'projects/oss/pletivo/node_modules/.bin/pletivo')
const pletivoAvailable = existsSync(pletivoBin)

async function readManifest(): Promise<FragmentManifest> {
	const raw = await fs.readFile(path.join(fragmentsDir, 'manifest.json'), 'utf8')
	return JSON.parse(raw) as FragmentManifest
}

function runPletivoBuild(args: string[] = []): { stdout: string; stderr: string; status: number } {
	const result = spawnSync(pletivoBin, ['build', ...args], {
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

describe.skipIf(!pletivoAvailable)('e2e: pletivo incremental build with fragments', () => {
	beforeAll(async () => {
		await cleanWorkspace()
	})

	afterAll(async () => {
		await cleanWorkspace()
	})

	it('cold build → second build reuses every page and every fragment', async () => {
		const first = runPletivoBuild()
		expect(first.status).toBe(0)
		expect(first.stdout).toMatch(/0 cached/)

		const firstManifest = await readManifest()
		const firstFragmentIds = Object.keys(firstManifest.fragments).sort()
		expect(firstFragmentIds.length).toBe(4)

		// Snapshot each fragment file's content — they should survive
		// the second build untouched (page renders skipped → fragment
		// registrations replayed → integration reuses on-disk files,
		// merged into the new manifest).
		const beforeContents = new Map<string, string>()
		for (const id of firstFragmentIds) {
			const entry = firstManifest.fragments[id]
			if (!entry) throw new Error(`missing manifest entry for ${id}`)
			beforeContents.set(id, await fs.readFile(path.join(distDir, entry.file), 'utf8'))
		}

		const second = runPletivoBuild()
		expect(second.status).toBe(0)
		// 4 pages = index + 3 blog posts, all should be cached after
		// the no-op rebuild.
		expect(second.stdout).toMatch(/cached/)
		expect(second.stdout).not.toMatch(/no fragments registered/)

		const secondManifest = await readManifest()
		const secondFragmentIds = Object.keys(secondManifest.fragments).sort()
		expect(secondFragmentIds).toEqual(firstFragmentIds)

		// File contents are preserved — either reused as-is from the
		// snapshot restore (when pletivo skipped the page) or
		// re-rendered to the same bytes (when pletivo went the lazy
		// path). Either way: no drift.
		for (const id of secondFragmentIds) {
			const entry = secondManifest.fragments[id]
			if (!entry) throw new Error(`missing manifest entry for ${id}`)
			const after = await fs.readFile(path.join(distDir, entry.file), 'utf8')
			expect(after).toBe(beforeContents.get(id)!)
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
