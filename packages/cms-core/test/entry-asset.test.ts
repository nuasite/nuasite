// Unit tests for `getEntryAsset` — resolving an entry's `image`/`file` value
// (a path stored relative to the entry source file) to raw bytes + a content
// type, with a project-root traversal guard. Builds its own temp project so it
// is independent of the shared fixture.
import { createCmsCore, createNodeFs } from '@nuasite/cms-core'
import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const CONFIG_SOURCE = `
import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { n } from '@nuasite/cms'

const note = defineCollection({
	loader: glob({ pattern: '**/*.yaml', base: './content/note' }),
	schema: n.object({ title: n.text(), hero: n.image() }),
})

export const collections = { note }
`

const PIC_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03])

const cleanups: string[] = []
afterEach(async () => {
	for (const dir of cleanups.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true })
	}
})

async function freshProject(): Promise<ReturnType<typeof createCmsCore>> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-core-asset-'))
	cleanups.push(root)
	await fs.mkdir(path.join(root, 'src'), { recursive: true })
	await fs.mkdir(path.join(root, 'content', 'note'), { recursive: true })
	await fs.mkdir(path.join(root, 'content', 'assets'), { recursive: true })
	await fs.writeFile(path.join(root, 'src', 'content.config.ts'), CONFIG_SOURCE)
	await fs.writeFile(path.join(root, 'content', 'note', 'hello.yaml'), 'title: Hello\nhero: ../assets/pic.webp\n')
	await fs.writeFile(path.join(root, 'content', 'assets', 'pic.webp'), PIC_BYTES)
	// Root-relative values (`/assets/x`, `/uploads/x`) point at Astro's `public/` dir,
	// which is served at the site root — plus a non-public root asset for the fallback.
	await fs.mkdir(path.join(root, 'public', 'assets'), { recursive: true })
	await fs.writeFile(path.join(root, 'public', 'assets', 'titul.jpeg'), PIC_BYTES)
	await fs.mkdir(path.join(root, 'public', 'uploads'), { recursive: true })
	await fs.writeFile(path.join(root, 'public', 'uploads', 'u.png'), PIC_BYTES)
	await fs.mkdir(path.join(root, 'data'), { recursive: true })
	await fs.writeFile(path.join(root, 'data', 'root-only.svg'), PIC_BYTES)
	return createCmsCore(createNodeFs(root))
}

describe('getEntryAsset', () => {
	test('resolves an entry-relative asset path → bytes + content type', async () => {
		const core = await freshProject()
		const asset = await core.getEntryAsset('note', 'hello', '../assets/pic.webp')
		if (asset === null) throw new Error('expected the asset to resolve')
		expect(asset.contentType).toBe('image/webp')
		expect(Buffer.from(asset.bytes)).toEqual(PIC_BYTES)
	})

	test('returns null when the path escapes the project root', async () => {
		const core = await freshProject()
		expect(await core.getEntryAsset('note', 'hello', '../../../../../../etc/passwd')).toBeNull()
	})

	test('returns null when the asset file does not exist', async () => {
		const core = await freshProject()
		expect(await core.getEntryAsset('note', 'hello', '../assets/missing.webp')).toBeNull()
	})

	test('returns null when the entry does not exist', async () => {
		const core = await freshProject()
		expect(await core.getEntryAsset('note', 'does-not-exist', '../assets/pic.webp')).toBeNull()
	})

	test('resolves a root-relative /assets value from public/ (Astro public convention)', async () => {
		const core = await freshProject()
		const asset = await core.getEntryAsset('note', 'hello', '/assets/titul.jpeg')
		if (asset === null) throw new Error('expected the asset to resolve')
		expect(asset.contentType).toBe('image/jpeg')
		expect(Buffer.from(asset.bytes)).toEqual(PIC_BYTES)
	})

	test('resolves a root-relative value even when the entry does not exist', async () => {
		const core = await freshProject()
		expect(await core.getEntryAsset('note', 'does-not-exist', '/assets/titul.jpeg')).not.toBeNull()
	})
})

describe('getProjectAsset', () => {
	test('resolves a root-relative /uploads value from public/ with no owning entry', async () => {
		const core = await freshProject()
		const asset = await core.getProjectAsset('/uploads/u.png')
		if (asset === null) throw new Error('expected the asset to resolve')
		expect(asset.contentType).toBe('image/png')
		expect(Buffer.from(asset.bytes)).toEqual(PIC_BYTES)
	})

	test('falls back to the project root when the path is not under public/', async () => {
		const core = await freshProject()
		expect(await core.getProjectAsset('/data/root-only.svg')).not.toBeNull()
	})

	test('returns null for a relative path (needs an owning entry)', async () => {
		const core = await freshProject()
		expect(await core.getProjectAsset('../assets/pic.webp')).toBeNull()
	})

	test('returns null on root traversal', async () => {
		const core = await freshProject()
		expect(await core.getProjectAsset('/../../etc/passwd')).toBeNull()
	})
})
