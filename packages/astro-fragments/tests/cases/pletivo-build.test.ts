import { beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FragmentManifest } from '../../src/manifest.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.resolve(here, '../fixtures/basic')
const distDir = path.join(fixtureRoot, 'dist')
const fragmentsDir = path.join(distDir, '_fragments')

// Pletivo lives in a sibling repo at ~/projects/oss/pletivo. Skip the
// suite if we can't find the binary — keeps CI green on machines that
// don't clone the pletivo source tree.
const pletivoBin = path.resolve(process.env.HOME ?? '', 'projects/oss/pletivo/node_modules/.bin/pletivo')
const pletivoAvailable = existsSync(pletivoBin)

async function readManifest(): Promise<FragmentManifest> {
	const raw = await fs.readFile(path.join(fragmentsDir, 'manifest.json'), 'utf8')
	return JSON.parse(raw) as FragmentManifest
}

async function readFile(p: string): Promise<string> {
	return await fs.readFile(p, 'utf8')
}

async function runPletivoBuild(): Promise<void> {
	await fs.rm(distDir, { recursive: true, force: true })
	const result = spawnSync(pletivoBin, ['build'], {
		cwd: fixtureRoot,
		encoding: 'utf8',
		env: { ...process.env, NODE_ENV: 'production' },
	})
	if (result.status !== 0) {
		throw new Error(`pletivo build failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
	}
}

const BUILD_TIMEOUT = 30_000

describe.skipIf(!pletivoAvailable)('e2e: pletivo build of the same astro fixture', () => {
	beforeAll(async () => {
		await runPletivoBuild()
	}, BUILD_TIMEOUT)

	it('builds without errors and emits fragments + manifest', async () => {
		const manifest = await readManifest()
		expect(manifest.version).toBe(1)
		expect(manifest.outputDir).toBe('_fragments')
		expect(Object.keys(manifest.fragments).length).toBe(4)
	})

	it('produces the same fragment ids as astro build (drop-in compat)', async () => {
		const manifest = await readManifest()
		const ids = Object.keys(manifest.fragments).sort()
		expect(ids).toEqual([
			'0b620a601f68', // LatestPosts (no props)
			'25abf5039053', // RelatedPosts(slug=second-post)
			'41536b735c81', // RelatedPosts(slug=third-post)
			'beb4204f7855', // RelatedPosts(slug=hello-world)
		])
	})

	it('emits placeholders in pages and naked HTML in fragment files', async () => {
		const indexHtml = await readFile(path.join(distDir, 'index.html'))
		expect(indexHtml).toMatch(/<x-fragment id="[a-f0-9]{12}"><\/x-fragment>/)
		expect(indexHtml).not.toContain('<section class="latest-posts">')

		const manifest = await readManifest()
		const latest = Object.values(manifest.fragments).find(f => f.moduleId.endsWith('LatestPosts.astro'))!
		const fragmentHtml = await readFile(path.join(distDir, latest.file))
		expect(fragmentHtml).not.toContain('<!DOCTYPE')
		expect(fragmentHtml).toContain('Latest posts')
	})

	it('renders parametrized fragments correctly', async () => {
		const manifest = await readManifest()
		const helloRelated = Object.values(manifest.fragments).find(f => f.moduleId.endsWith('RelatedPosts.astro') && f.props.slug === 'hello-world')!
		const html = await readFile(path.join(distDir, helloRelated.file))
		expect(html).toContain('Related to hello-world')
	})
})
