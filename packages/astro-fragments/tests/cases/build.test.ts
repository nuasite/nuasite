import { beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FragmentManifest } from '../../src/manifest.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.resolve(here, '../fixtures/basic')
const distDir = path.join(fixtureRoot, 'dist')
const fragmentsDir = path.join(distDir, '_fragments')

async function readManifest(): Promise<FragmentManifest> {
	const raw = await fs.readFile(path.join(fragmentsDir, 'manifest.json'), 'utf8')
	return JSON.parse(raw) as FragmentManifest
}

async function readFile(p: string): Promise<string> {
	return await fs.readFile(p, 'utf8')
}

async function runBuild(): Promise<void> {
	await fs.rm(distDir, { recursive: true, force: true })
	const result = spawnSync('bun', ['x', 'astro', 'build'], {
		cwd: fixtureRoot,
		encoding: 'utf8',
		env: { ...process.env, NODE_ENV: 'production' },
	})
	if (result.status !== 0) {
		throw new Error(`astro build failed (exit ${result.status}):\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
	}
}

const BUILD_TIMEOUT = 30_000

describe('e2e: basic fixture build', () => {
	beforeAll(async () => {
		await runBuild()
	}, BUILD_TIMEOUT)

	it('builds without errors and emits fragments + manifest', async () => {
		const manifest = await readManifest()

		expect(manifest.version).toBe(1)
		expect(manifest.outputDir).toBe('_fragments')
		expect(typeof manifest.generatedAt).toBe('string')
		expect(Object.keys(manifest.fragments).length).toBe(4)
	})

	it('emits one fragment file per unique (component, props) pair', async () => {
		const manifest = await readManifest()
		const ids = Object.keys(manifest.fragments)
		for (const id of ids) {
			const filePath = path.join(distDir, manifest.fragments[id]!.file)
			const stat = await fs.stat(filePath)
			expect(stat.isFile()).toBe(true)
			expect(stat.size).toBeGreaterThan(0)
		}
	})

	it('deduplicates LatestPosts across all 4 pages (one render, 4 usedBy)', async () => {
		const manifest = await readManifest()
		const latest = Object.values(manifest.fragments).find(f => f.moduleId.endsWith('LatestPosts.astro'))
		expect(latest).toBeDefined()
		expect(latest!.usedBy).toEqual([
			'blog/hello-world/index.html',
			'blog/second-post/index.html',
			'blog/third-post/index.html',
			'index.html',
		])
		expect(latest!.props).toEqual({})
	})

	it('emits one RelatedPosts fragment per slug', async () => {
		const manifest = await readManifest()
		const related = Object.values(manifest.fragments).filter(f => f.moduleId.endsWith('RelatedPosts.astro'))
		expect(related.length).toBe(3)
		const slugs = related.map(f => f.props.slug as string).sort()
		expect(slugs).toEqual(['hello-world', 'second-post', 'third-post'])
		for (const r of related) {
			expect(r.usedBy.length).toBe(1)
		}
	})

	it('replaces <Fragment> usage in pages with <x-fragment id> placeholders only', async () => {
		const indexHtml = await readFile(path.join(distDir, 'index.html'))
		const blogHtml = await readFile(path.join(distDir, 'blog/hello-world/index.html'))

		expect(indexHtml).not.toContain('<section class="latest-posts">')
		expect(indexHtml).toMatch(/<x-fragment id="[a-f0-9]{12}"><\/x-fragment>/)

		expect(blogHtml).not.toContain('<aside class="related">')
		expect(blogHtml).not.toContain('<section class="latest-posts">')
		const matches = blogHtml.match(/<x-fragment id="[a-f0-9]{12}"><\/x-fragment>/g)
		expect(matches).not.toBeNull()
		expect(matches!.length).toBe(2)
	})

	it('emits naked HTML snippets in fragment files (no <html>, <head>, <body>)', async () => {
		const manifest = await readManifest()
		for (const entry of Object.values(manifest.fragments)) {
			const html = await readFile(path.join(distDir, entry.file))
			expect(html).not.toContain('<html')
			expect(html).not.toContain('<head>')
			expect(html).not.toContain('<body')
			expect(html).not.toContain('<!DOCTYPE')
		}
	})

	it('generates stable ids: rebuilding produces the same hash set', async () => {
		const first = await readManifest()
		await runBuild()
		const second = await readManifest()
		expect(Object.keys(first.fragments).sort()).toEqual(Object.keys(second.fragments).sort())
	}, BUILD_TIMEOUT)

	it('produces project-relative moduleId in the manifest (deterministic across machines)', async () => {
		const manifest = await readManifest()
		for (const entry of Object.values(manifest.fragments)) {
			expect(entry.moduleId.startsWith('/')).toBe(false)
			expect(entry.moduleId).toMatch(/^src\/fragments\//)
		}
	})

	it('matches fragment HTML content for LatestPosts', async () => {
		const manifest = await readManifest()
		const latest = Object.values(manifest.fragments).find(f => f.moduleId.endsWith('LatestPosts.astro'))!
		const html = await readFile(path.join(distDir, latest.file))
		expect(html).toContain('Latest posts')
		expect(html).toContain('hello-world')
		expect(html).toContain('second-post')
		expect(html).toContain('third-post')
	})

	it('renders RelatedPosts fragment with correct slug-specific content', async () => {
		const manifest = await readManifest()
		const helloRelated = Object.values(manifest.fragments).find(f => f.moduleId.endsWith('RelatedPosts.astro') && f.props.slug === 'hello-world')!
		const html = await readFile(path.join(distDir, helloRelated.file))
		expect(html).toContain('Related to hello-world')
		expect(html).not.toContain('Related to second-post')
	})
})
