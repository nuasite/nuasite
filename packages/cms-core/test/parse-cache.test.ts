import { type CmsFileSystem, type ParseCache, parseContentConfig } from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'

const CONFIG_SOURCE = `
import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
const blog = defineCollection({ schema: z.object({ title: z.string() }) })
export const collections = { blog }
`

/** Minimal in-memory CmsFileSystem that counts readFile/stat calls and lets us bump mtime. */
function makeCountingFs(initialMtime: number): {
	fs: CmsFileSystem
	counts: { read: number; stat: number }
	setMtime: (m: number) => void
} {
	let mtimeMs = initialMtime
	const counts = { read: 0, stat: 0 }
	const fs: CmsFileSystem = {
		async readFile(p) {
			counts.read++
			if (p === 'src/content/config.ts') return CONFIG_SOURCE
			throw new Error(`ENOENT: ${p}`)
		},
		async readBytes(p) {
			throw new Error(`not used: ${p}`)
		},
		async stat(p) {
			counts.stat++
			if (p === 'src/content/config.ts') return { mtimeMs, size: CONFIG_SOURCE.length }
			throw new Error(`ENOENT: ${p}`)
		},
		writeFile() {
			throw new Error('not used')
		},
		rename() {
			throw new Error('not used')
		},
		remove() {
			throw new Error('not used')
		},
		async exists() {
			return false
		},
		async list() {
			return []
		},
		async glob() {
			return []
		},
	}
	return {
		fs,
		counts,
		setMtime: m => {
			mtimeMs = m
		},
	}
}

describe('parseContentConfig — mtime-keyed cache', () => {
	test('a second parse with unchanged mtime does not re-read or re-parse', async () => {
		const { fs, counts } = makeCountingFs(1000)
		const cache: ParseCache = new Map()

		const first = await parseContentConfig(fs, cache)
		expect(first.has('blog')).toBe(true)
		const readsAfterFirst = counts.read
		expect(readsAfterFirst).toBe(1)

		const second = await parseContentConfig(fs, cache)
		expect(second.has('blog')).toBe(true)
		// stat is consulted again to check freshness, but the file is NOT re-read.
		expect(counts.read).toBe(readsAfterFirst)
		// Same cached instance is returned.
		expect(second).toBe(first)
	})

	test('a changed mtime invalidates the cache and triggers a re-read', async () => {
		const { fs, counts, setMtime } = makeCountingFs(1000)
		const cache: ParseCache = new Map()

		await parseContentConfig(fs, cache)
		expect(counts.read).toBe(1)

		setMtime(2000)
		await parseContentConfig(fs, cache)
		expect(counts.read).toBe(2)
	})
})
