import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { pickReusableManifestIds, readExistingManifest, validateAcceptable } from '../../src/integration.ts'
import { buildManifest, type FragmentManifest } from '../../src/manifest.ts'

let tmpDir = ''

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-fragments-reuse-'))
})

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeManifest(distDir: string, manifest: FragmentManifest): Promise<string> {
	const outDir = path.join(distDir, manifest.outputDir)
	await fs.mkdir(outDir, { recursive: true })
	const manifestPath = path.join(outDir, 'manifest.json')
	await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
	return manifestPath
}

async function writeFragment(distDir: string, manifest: FragmentManifest, hash: string, contents = '<p>cached</p>'): Promise<void> {
	const entry = manifest.fragments[hash]
	if (!entry) throw new Error(`no entry for ${hash}`)
	const filePath = path.join(distDir, entry.file)
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, contents, 'utf8')
}

function fakeManifest(entries: Array<{ hash: string; moduleId: string; props?: Record<string, unknown> }>): FragmentManifest {
	return buildManifest({
		outputDir: '_fragments',
		entries: entries.map(e => ({
			hash: e.hash,
			moduleId: e.moduleId,
			props: e.props ?? {},
			usedBy: [],
			size: 0,
		})),
	})
}

describe('readExistingManifest', () => {
	it('returns null when the manifest is absent', async () => {
		const result = await readExistingManifest(path.join(tmpDir, 'does-not-exist.json'))
		expect(result).toBeNull()
	})

	it('returns null when the JSON is corrupt', async () => {
		const p = path.join(tmpDir, 'bad.json')
		await fs.writeFile(p, '{ not valid json', 'utf8')
		expect(await readExistingManifest(p)).toBeNull()
	})

	it('returns null when version is wrong', async () => {
		const p = path.join(tmpDir, 'wrong-version.json')
		await fs.writeFile(p, JSON.stringify({ version: 99, fragments: {} }), 'utf8')
		expect(await readExistingManifest(p)).toBeNull()
	})

	it('round-trips a valid manifest', async () => {
		const manifest = fakeManifest([{ hash: 'abc123', moduleId: 'src/A.astro' }])
		const p = await writeManifest(tmpDir, manifest)
		const loaded = await readExistingManifest(p)
		expect(loaded).not.toBeNull()
		expect(loaded!.fragments.abc123?.moduleId).toBe('src/A.astro')
	})

	it('returns null when an entry is malformed', async () => {
		const p = path.join(tmpDir, 'malformed-entry.json')
		await fs.writeFile(
			p,
			JSON.stringify({
				version: 1,
				generatedAt: new Date().toISOString(),
				outputDir: '_fragments',
				// `usedBy` should be an array — the per-entry validator
				// must reject this rather than carry the garbage forward.
				fragments: { abc123: { id: 'abc123', file: '_fragments/abc123.html', moduleId: 'src/A.astro', props: {}, usedBy: 'oops', size: 0 } },
			}),
			'utf8',
		)
		expect(await readExistingManifest(p)).toBeNull()
	})

	it('returns null when an entry id disagrees with its map key', async () => {
		const p = path.join(tmpDir, 'wrong-key.json')
		await fs.writeFile(
			p,
			JSON.stringify({
				version: 1,
				generatedAt: new Date().toISOString(),
				outputDir: '_fragments',
				fragments: { abc123: { id: 'somethingElse', file: '_fragments/abc123.html', moduleId: 'src/A.astro', props: {}, usedBy: [], size: 0 } },
			}),
			'utf8',
		)
		expect(await readExistingManifest(p)).toBeNull()
	})
})

describe('pickReusableManifestIds', () => {
	it('returns empty when no prior manifest exists', async () => {
		const result = await pickReusableManifestIds(null, new Set(), tmpDir)
		expect(result.size).toBe(0)
	})

	it('reuses entries whose files are still on disk and are not being re-registered', async () => {
		const manifest = fakeManifest([
			{ hash: 'aaa', moduleId: 'src/A.astro' },
			{ hash: 'bbb', moduleId: 'src/B.astro' },
		])
		await writeManifest(tmpDir, manifest)
		await writeFragment(tmpDir, manifest, 'aaa')
		await writeFragment(tmpDir, manifest, 'bbb')
		const result = await pickReusableManifestIds(manifest, new Set(), tmpDir)
		expect([...result].sort()).toEqual(['aaa', 'bbb'])
	})

	it('skips entries that are also being freshly re-registered', async () => {
		const manifest = fakeManifest([
			{ hash: 'aaa', moduleId: 'src/A.astro' },
			{ hash: 'bbb', moduleId: 'src/B.astro' },
		])
		await writeManifest(tmpDir, manifest)
		await writeFragment(tmpDir, manifest, 'aaa')
		await writeFragment(tmpDir, manifest, 'bbb')
		// bbb will be re-rendered fresh → must NOT show up in the reuse set.
		const result = await pickReusableManifestIds(manifest, new Set(['bbb']), tmpDir)
		expect([...result]).toEqual(['aaa'])
	})

	it('drops entries whose file has been evicted from disk', async () => {
		const manifest = fakeManifest([
			{ hash: 'aaa', moduleId: 'src/A.astro' },
			{ hash: 'bbb', moduleId: 'src/B.astro' },
		])
		await writeManifest(tmpDir, manifest)
		await writeFragment(tmpDir, manifest, 'aaa')
		// bbb file is missing — must not be reusable.
		const result = await pickReusableManifestIds(manifest, new Set(), tmpDir)
		expect([...result]).toEqual(['aaa'])
	})
})

describe('validateAcceptable', () => {
	it('passes when every placeholder is in the registered or reused set', () => {
		expect(() =>
			validateAcceptable(
				[
					{ id: 'aaa', pageFile: 'index.html' },
					{ id: 'bbb', pageFile: 'blog/x.html' },
				],
				new Set(['aaa']),
				new Set(['bbb']),
			)
		).not.toThrow()
	})

	it('throws on dangling placeholders (deleted fragment, stale dist)', () => {
		expect(() =>
			validateAcceptable(
				[{ id: 'orphan', pageFile: 'index.html' }],
				new Set(['aaa']),
				new Set(['bbb']),
			)
		).toThrow(/orphan/)
	})

	it('passes trivially when there are no placeholders', () => {
		expect(() => validateAcceptable([], new Set(), new Set())).not.toThrow()
	})
})
