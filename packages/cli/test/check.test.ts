import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { astroRoots } from '../src/check'

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
