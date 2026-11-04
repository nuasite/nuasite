import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import astroFragments, { renderFragments } from '../../src/integration.ts'
import { buildManifest, readExistingManifest } from '../../src/manifest.ts'

const KEPT = 'aaaaaaaaaaaa'
const UNREFERENCED = 'bbbbbbbbbbbb'
const ORPHAN = 'cccccccccccc'

let distDir = ''
const logger = { info: () => {} }

async function write(relPath: string, contents: string): Promise<void> {
	const filePath = path.join(distDir, relPath)
	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, contents, 'utf8')
}

beforeEach(async () => {
	distDir = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-fragments-render-'))
	// A dist/ an incremental host kept from the previous build, with no page rendered (nothing registered) this time.
	await write('index.html', `<html><body><x-fragment id="${KEPT}"></x-fragment></body></html>`)
	await write('about/index.html', '<html><body>no fragments</body></html>')
	const prior = buildManifest({
		outputDir: '_fragments',
		entries: [
			{ hash: KEPT, moduleId: 'src/A.astro', props: {}, usedBy: ['deleted/index.html'], size: 3 },
			{ hash: UNREFERENCED, moduleId: 'src/B.astro', props: {}, usedBy: ['deleted/index.html'], size: 3 },
		],
	})
	await write('_fragments/manifest.json', JSON.stringify(prior))
	await write(`_fragments/${KEPT}.html`, '<p>')
	await write(`_fragments/${UNREFERENCED}.html`, '<p>')
	await write(`_fragments/${ORPHAN}.html`, '<p>')
	await write('_fragments/README.txt', 'not ours')
})

afterEach(async () => {
	await fs.rm(distDir, { recursive: true, force: true })
})

const params = () => ({ distDir, outputDir: '_fragments', manifestName: 'manifest.json', concurrency: 2, logger })

describe('renderFragments on a kept dist/', () => {
	it('keeps referenced entries with usedBy from the scan and deletes unreferenced fragment files', async () => {
		await renderFragments(params())

		const manifest = await readExistingManifest(path.join(distDir, '_fragments/manifest.json'))
		expect(Object.keys(manifest?.fragments ?? {})).toEqual([KEPT])
		expect(manifest?.fragments[KEPT]?.usedBy).toEqual(['index.html'])
		expect(existsSync(path.join(distDir, `_fragments/${KEPT}.html`))).toBe(true)
		expect(existsSync(path.join(distDir, `_fragments/${UNREFERENCED}.html`))).toBe(false)
		expect(existsSync(path.join(distDir, `_fragments/${ORPHAN}.html`))).toBe(false)
		expect(existsSync(path.join(distDir, '_fragments/README.txt'))).toBe(true)
	})

	it('removes the manifest and every fragment file when no page uses a fragment any more', async () => {
		await write('index.html', '<html><body>fragment removed</body></html>')
		await renderFragments(params())

		expect(await fs.readdir(path.join(distDir, '_fragments'))).toEqual(['README.txt'])
	})

	it('fails on a placeholder whose fragment file is gone', async () => {
		await fs.rm(path.join(distDir, `_fragments/${KEPT}.html`))
		await expect(renderFragments(params())).rejects.toThrow(`<x-fragment id="${KEPT}"> in index.html`)
	})
})

describe('outputDir option', () => {
	it.each(['.', '', '..', '../out', '/abs/out', 'a/../..'])('rejects %p, which is not a subdirectory of the build output', outputDir => {
		expect(() => astroFragments({ outputDir })).toThrow(/outputDir must be a subdirectory/)
	})

	it('accepts nested subdirectories', () => {
		expect(() => astroFragments({ outputDir: 'assets/fragments/' })).not.toThrow()
	})
})
