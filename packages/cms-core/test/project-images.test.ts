import { createNodeFs, listProjectImages } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'

/** PNG magic bytes — the scan goes by extension, so the payload only has to be a file. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('listProjectImages', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__project-images-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	/** Write root-relative files (parent dirs included). */
	async function write(files: Record<string, Buffer | string>): Promise<void> {
		for (const [relative, content] of Object.entries(files)) {
			const target = path.join(root, relative)
			await fs.mkdir(path.dirname(target), { recursive: true })
			await fs.writeFile(target, content)
		}
	}

	test('serves public/ from the public root and src/ from the project root', async () => {
		await write({
			'public/assets/hero.png': PNG,
			'public/logo.svg': PNG,
			'src/assets/inline.webp': PNG,
		})
		const items = await listProjectImages(createNodeFs(root))
		expect(items.map(i => i.url)).toEqual(['/assets/hero.png', '/src/assets/inline.webp', '/logo.svg'])
		expect(items.map(i => i.id)).toEqual(['project:/assets/hero.png', 'project:/src/assets/inline.webp', 'project:/logo.svg'])
		expect(items.find(i => i.filename === 'hero.png')?.contentType).toBe('image/png')
		expect(items.find(i => i.filename === 'logo.svg')?.contentType).toBe('image/svg+xml')
	})

	test('takes images only, and skips dotfiles and node_modules', async () => {
		await write({
			'public/keep.png': PNG,
			'public/notes.txt': 'text',
			'public/doc.pdf': PNG,
			'public/movie.mp4': PNG,
			'public/.hidden/secret.png': PNG,
			'public/.dotfile.png': PNG,
			'src/node_modules/pkg/bundled.png': PNG,
		})
		const items = await listProjectImages(createNodeFs(root))
		expect(items.map(i => i.url)).toEqual(['/keep.png'])
	})

	test('returns [] when neither public/ nor src/ exists', async () => {
		expect(await listProjectImages(createNodeFs(root))).toEqual([])
	})

	test('excludeDir drops the uploads directory, in every spelling the port accepts', async () => {
		await write({ 'public/uploads/up.png': PNG, 'public/assets/hero.png': PNG })
		const cfs = createNodeFs(root)
		for (const spelling of ['public/uploads', '/public/uploads', 'public/uploads/', '/public/uploads/']) {
			const items = await listProjectImages(cfs, { excludeDir: spelling })
			expect(items.map(i => i.url)).toEqual(['/assets/hero.png'])
		}
		// Without the exclusion the uploads show up — the assertion above is not vacuous.
		expect((await listProjectImages(cfs)).map(i => i.url).sort()).toEqual(['/assets/hero.png', '/uploads/up.png'])
	})

	// --- Ordering ---------------------------------------------------------------
	//
	// The sidecar paginates this list by positional offset, so the order has to be a
	// *total* one: same tree in, same sequence out, every time. Sorting by the bare
	// filename is not — files sharing a name tie, and the ties then keep the walk's
	// own push order, which is non-deterministic because the recursive scan pushes
	// into one array from concurrently awaited branches.

	/** 6 sibling directories, each holding the same two filenames. */
	async function writeCollidingNames(): Promise<void> {
		const files: Record<string, Buffer> = {}
		for (const dir of ['a', 'b', 'c', 'd', 'e', 'f']) {
			files[`public/${dir}/hero.png`] = PNG
			files[`public/${dir}/logo.png`] = PNG
		}
		await write(files)
	}

	test('orders by filename, then by URL, when the same filename repeats across directories', async () => {
		await writeCollidingNames()
		const items = await listProjectImages(createNodeFs(root))
		expect(items.map(i => i.url)).toEqual([
			'/a/hero.png',
			'/b/hero.png',
			'/c/hero.png',
			'/d/hero.png',
			'/e/hero.png',
			'/f/hero.png',
			'/a/logo.png',
			'/b/logo.png',
			'/c/logo.png',
			'/d/logo.png',
			'/e/logo.png',
			'/f/logo.png',
		])
	})

	test('repeated calls over an unchanged tree return the identical order', async () => {
		await writeCollidingNames()
		const cfs = createNodeFs(root)
		const orderings = new Set<string>()
		for (let i = 0; i < 40; i++) {
			orderings.add((await listProjectImages(cfs)).map(item => item.url).join('|'))
		}
		expect(orderings.size).toBe(1)
	})

	test('offset pagination over the scan neither repeats nor drops an item', async () => {
		await writeCollidingNames()
		const cfs = createNodeFs(root)
		const expected = (await listProjectImages(cfs)).map(i => i.url)

		// Walk the list the way the sidecar's media cursor does: re-scan per page, slice by offset.
		const seen: string[] = []
		for (let offset = 0; offset < 100; offset += 3) {
			const page = (await listProjectImages(cfs)).slice(offset, offset + 3)
			if (page.length === 0) break
			seen.push(...page.map(i => i.url))
		}
		expect(seen).toEqual(expected)
		expect(new Set(seen).size).toBe(seen.length)
	})
})
