import { createLocalStorageAdapter } from '@nuasite/cms-core'
import type { MediaStorageAdapter } from '@nuasite/cms-types'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { existsSync, lstatSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * The uploads directory sits three levels below the temp root, with a sentinel file at
 * every level above it and in two sibling directories, one of which only differs from
 * it by a suffix. No id below climbs further than the root, so a regression can only
 * ever remove a file this test created.
 */
const UPLOADS = 'site/public/uploads'
const OUTSIDE = [
	'site/public/victim.txt',
	'site/victim.txt',
	'victim.txt',
	'site/public/elsewhere/victim.txt',
	'site/public/uploads-evil/victim.txt',
]
const INSIDE = ['keep.png', 'photos/keep.png']

/** File names only a filesystem with `/` as its one separator can hold. */
const posixOnly = path.sep === '\\'

describe('createLocalStorageAdapter', () => {
	let root: string
	let uploads: string
	let adapter: MediaStorageAdapter

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'cms-core-media-local-'))
		uploads = path.join(root, UPLOADS)
		for (const relative of [...OUTSIDE, ...INSIDE.map(f => `${UPLOADS}/${f}`)]) {
			await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true })
			await fs.writeFile(path.join(root, relative), 'x')
		}
		adapter = createLocalStorageAdapter({ dir: uploads })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	/** Every file the test planted is still there, outside the uploads directory and inside it. */
	function expectNothingRemoved(): void {
		for (const relative of OUTSIDE) expect(existsSync(path.join(root, relative))).toBe(true)
		for (const relative of INSIDE) expect(existsSync(path.join(uploads, relative))).toBe(true)
	}

	/** Every file, directory and symlink under the temp root, relative to it. Symlinks are listed, not followed. */
	async function tree(from = root): Promise<string[]> {
		const found: string[] = []
		for (const entry of await fs.readdir(from, { withFileTypes: true })) {
			const full = path.join(from, entry.name)
			found.push(path.relative(root, full))
			if (entry.isDirectory()) found.push(...await tree(full))
		}
		return found.sort()
	}

	/** Symlink `uploads/<name>` to a path relative to the temp root. */
	async function link(name: string, target: string): Promise<void> {
		await fs.symlink(path.join(root, target), path.join(uploads, name))
	}

	const upload = (target: MediaStorageAdapter, folder?: string) => target.upload(Buffer.from('x'), 'pic.png', 'image/png', { folder })

	describe('delete', () => {
		test('removes what upload returned, at the root and in a nested folder', async () => {
			for (const folder of [undefined, 'photos', 'photos/2026']) {
				const uploaded = await upload(adapter, folder)
				expect(uploaded.success).toBe(true)
				const file = path.join(uploads, uploaded.id!)
				expect(existsSync(file)).toBe(true)

				expect(await adapter.delete(uploaded.id!)).toEqual({ success: true })
				expect(existsSync(file)).toBe(false)
			}
			expectNothingRemoved()
		})

		test('removes every id list hands out, whatever the file is called', async () => {
			const names = ['with space.png', 'žluťoučký kůň.jpg', 'a..b.png', 'dots...png', 'no-extension', '%2e%2e%2fencoded.png']
			for (const name of names) await fs.writeFile(path.join(uploads, 'photos', name), 'x')

			const listed = await adapter.list({ folder: 'photos' })
			expect(listed.items.map(i => i.filename).sort()).toEqual([...names, 'keep.png'].sort())

			for (const item of listed.items.filter(i => i.filename !== 'keep.png')) {
				expect(await adapter.delete(item.id)).toEqual({ success: true })
			}
			expect((await fs.readdir(path.join(uploads, 'photos'))).sort()).toEqual(['keep.png'])
			expectNothingRemoved()
		})

		test.skipIf(posixOnly)('removes and lists into names with a backslash or a control character, which list hands out too', async () => {
			const names = ['back\\slash.png', 'a\\..\\..\\victim.txt', 'new\nline.png', 'tab\t.png', 'bell\u0007.png', 'del\u007f.png']
			const folder = 'photos\\2026'
			await fs.mkdir(path.join(uploads, folder))
			for (const name of names) {
				await fs.writeFile(path.join(uploads, name), 'x')
				await fs.writeFile(path.join(uploads, folder, name), 'x')
			}

			const atRoot = await adapter.list()
			expect(atRoot.folders.map(f => f.path)).toContain(folder)
			const inFolder = await adapter.list({ folder })
			expect(inFolder.items.map(i => i.id).sort()).toEqual(names.map(name => `${folder}/${name}`).sort())

			for (const item of [...atRoot.items.filter(i => names.includes(i.filename)), ...inFolder.items]) {
				expect({ id: item.id, result: await adapter.delete(item.id) }).toEqual({ id: item.id, result: { success: true } })
			}
			expect((await fs.readdir(uploads)).sort()).toEqual(['keep.png', 'photos', folder].sort())
			expect(await fs.readdir(path.join(uploads, folder))).toEqual([])

			const uploaded = await upload(adapter, folder)
			expect(uploaded.id).toBe(`${folder}/${uploaded.filename}`)
			expect(await adapter.delete(uploaded.id!)).toEqual({ success: true })
			expectNothingRemoved()
		})

		const escaping = [
			'../victim.txt',
			'../../victim.txt',
			'../../../victim.txt',
			'photos/../../victim.txt',
			'photos/../../../victim.txt',
			'./../victim.txt',
			'/../victim.txt',
			'//../victim.txt',
			'../elsewhere/victim.txt',
			'../uploads-evil/victim.txt',
			'../uploads/keep.png',
			'../victim.txt\n',
		]
		for (const id of escaping) {
			test(`refuses ${JSON.stringify(id)}, which climbs out of the uploads directory`, async () => {
				expect(await adapter.delete(id)).toEqual({ success: false, error: 'Invalid media id' })
				expectNothingRemoved()
			})
		}

		test('refuses an absolute path, inside the uploads directory or not', async () => {
			for (const id of [path.join(root, 'victim.txt'), path.join(uploads, 'keep.png'), '/keep.png', '/photos/keep.png']) {
				expect(await adapter.delete(id)).toEqual({ success: false, error: 'Invalid media id' })
			}
			expectNothingRemoved()
		})

		test('refuses dot and empty segments even when they resolve inside', async () => {
			for (const id of ['./keep.png', 'photos/./keep.png', 'photos/../keep.png', 'photos//keep.png', 'photos/keep.png/', 'photos/keep.png/.']) {
				expect(await adapter.delete(id)).toEqual({ success: false, error: 'Invalid media id' })
			}
			expectNothingRemoved()
		})

		test('refuses a NUL, which no file name can hold', async () => {
			for (const id of ['keep.png\0', 'keep.png\0.jpg', '\0../victim.txt', '../victim.txt\0', 'photos/\0']) {
				expect(await adapter.delete(id)).toEqual({ success: false, error: 'Invalid media id' })
			}
			expectNothingRemoved()
		})

		test.skipIf(posixOnly)('reads a backslash or a control character as part of a name, so it separates and climbs nothing', async () => {
			const ids = [
				'..\\victim.txt',
				'..\\..\\victim.txt',
				'photos\\keep.png',
				'photos\\..\\..\\victim.txt',
				'\\keep.png',
				'\t../victim.txt',
				'keep.png\r\n',
			]
			for (const id of ids) {
				expect(await adapter.delete(id)).toEqual({ success: false, error: 'Media file not found' })
			}
			expectNothingRemoved()
		})

		test('refuses an id that names the uploads directory itself or one above it', async () => {
			for (const id of ['', '.', '..', '/', './', 'photos/..', 'photos/../..']) {
				expect(await adapter.delete(id)).toEqual({ success: false, error: 'Invalid media id' })
			}
			expect(existsSync(uploads)).toBe(true)
			expectNothingRemoved()
		})

		test('an id is never decoded: percent-encoded separators are just a file name', async () => {
			for (const id of ['..%2Fvictim.txt', '%2e%2e/victim.txt', '%2e%2e%2fvictim.txt', '..%5Cvictim.txt', '%00']) {
				expect(await adapter.delete(id)).toEqual({ success: false, error: 'Media file not found' })
			}
			expectNothingRemoved()
		})

		test('fails without removing anything for a missing file or a folder, and never reports a filesystem path', async () => {
			const missing = await adapter.delete('nope.png')
			expect(missing).toEqual({ success: false, error: 'Media file not found' })
			expect(await adapter.delete('nope/nope.png')).toEqual({ success: false, error: 'Media file not found' })

			const folder = await adapter.delete('photos')
			expect(folder.success).toBe(false)
			expect(existsSync(path.join(uploads, 'photos'))).toBe(true)

			const underAFile = await adapter.delete('keep.png/x.png')
			expect(underAFile.success).toBe(false)

			const tooLong = await adapter.delete('x'.repeat(5000))
			expect(tooLong.success).toBe(false)

			for (const result of [missing, folder, underAFile, tooLong]) {
				expect(result.error).not.toContain(root)
				expect(result.error).not.toContain('uploads')
			}
			expectNothingRemoved()
		})

		test('removes a symlink as the last name itself and leaves what it points to', async () => {
			await link('linked.txt', 'victim.txt')
			await link('linked-folder', 'site/public/elsewhere')
			await link('photos/dangling', 'nowhere')
			await fs.symlink('loop', path.join(uploads, 'loop'))

			for (const id of ['linked.txt', 'linked-folder', 'photos/dangling', 'loop']) {
				expect({ id, result: await adapter.delete(id) }).toEqual({ id, result: { success: true } })
				expect(() => lstatSync(path.join(uploads, id))).toThrow()
			}
			expect(existsSync(path.join(root, 'nowhere'))).toBe(false)
			expectNothingRemoved()
		})

		test('refuses a symlinked file anywhere but as the last name', async () => {
			await link('linked.txt', 'victim.txt')
			await link('photos/linked.txt', 'victim.txt')

			for (const id of ['linked.txt/x.png', 'photos/linked.txt/x.png', 'photos/linked.txt/a/b.png']) {
				expect({ id, result: await adapter.delete(id) }).toEqual({ id, result: { success: false, error: 'Invalid media id' } })
			}
			expect(lstatSync(path.join(uploads, 'linked.txt')).isSymbolicLink()).toBe(true)
			expectNothingRemoved()
		})
	})

	describe('folder', () => {
		const escaping = [
			'..',
			'../..',
			'../elsewhere',
			'../uploads-evil',
			'../made-up',
			'photos/../..',
			'photos/../../made-up',
			'.',
			'./photos',
			'photos\0',
		]

		test('list reads nothing and creates nothing for a folder outside the uploads directory', async () => {
			const before = await tree()
			for (const folder of escaping) {
				expect(await adapter.list({ folder })).toEqual({ items: [], folders: [], hasMore: false })
			}
			expect(await tree()).toEqual(before)
		})

		test('upload writes nothing for a folder outside the uploads directory', async () => {
			const before = await tree()
			for (const folder of escaping) {
				expect(await upload(adapter, folder)).toEqual({ success: false, error: 'Invalid folder name' })
			}
			expect(await tree()).toEqual(before)
		})

		test('createFolder creates nothing for a folder outside the uploads directory', async () => {
			const before = await tree()
			for (const folder of escaping) {
				expect(await adapter.createFolder!(folder)).toEqual({ success: false, error: 'Invalid folder name' })
			}
			expect(await tree()).toEqual(before)
		})

		test('list, upload and createFolder keep working for a nested folder, stray slashes included', async () => {
			expect(await adapter.createFolder!('albums/2026')).toEqual({ success: true })
			expect(await adapter.createFolder!('/albums/2027/')).toEqual({ success: true })
			expect((await adapter.list({ folder: 'albums' })).folders).toEqual([
				{ name: '2026', path: 'albums/2026' },
				{ name: '2027', path: 'albums/2027' },
			])

			for (const folder of ['albums/2026', '/albums//2026/']) {
				const uploaded = await upload(adapter, folder)
				expect(uploaded.success).toBe(true)
				expect(uploaded.id).toBe(`albums/2026/${uploaded.filename}`)
				expect(uploaded.url).toBe(`/uploads/albums/2026/${uploaded.filename}`)

				const listed = await adapter.list({ folder })
				expect(listed.items.map(i => i.id)).toContain(uploaded.id!)
				expect(await adapter.delete(uploaded.id!)).toEqual({ success: true })
			}
			expectNothingRemoved()
		})

		test('a name that belongs to a file, or is too long, fails without reporting a filesystem path', async () => {
			const before = await tree()
			const folders = ['keep.png', 'keep.png/sub', 'photos/keep.png/a/b', 'x'.repeat(300), Array.from({ length: 600 }, () => 'folder').join('/')]
			for (const folder of folders) {
				expect(await adapter.list({ folder })).toEqual({ items: [], folders: [], hasMore: false })

				for (const result of [await upload(adapter, folder), await adapter.createFolder!(folder)]) {
					expect(result.success).toBe(false)
					expect(result.error).toMatch(/^Failed to (store media file|create folder) \((EEXIST|ENOTDIR|ENAMETOOLONG)\)$/)
				}
			}
			expect(await tree()).toEqual(before)
		})
	})

	describe('symlinked folder', () => {
		/** Where a link may sit: as the first name below the uploads directory, in the middle, or deepest. */
		const PARENTS = ['', 'photos/', 'photos/2026/']
		/** What it may point at. None of it matters: a link is refused for being one. */
		const KINDS = ['outside', 'sibling', 'inside', 'dangling', 'loop']

		/** Every link the fixture plants, as the folder a caller would name. */
		const LINKS = PARENTS.flatMap(parent => KINDS.map(kind => `${parent}${kind}`))
		/** Each link named as the folder itself, and with a part below it that does not exist. */
		const FOLDERS = LINKS.flatMap(folder => [folder, `${folder}/sub`, `${folder}/not/there/yet`])

		beforeEach(async () => {
			await fs.mkdir(path.join(uploads, 'photos/2026'))
			await fs.mkdir(path.join(uploads, 'real'))
			await fs.writeFile(path.join(uploads, 'real/keep.png'), 'x')
			await fs.writeFile(path.join(root, 'site/public/elsewhere/keep.png'), 'x')
			await fs.writeFile(path.join(root, 'site/public/uploads-evil/keep.png'), 'x')
			const targets: Record<string, string> = {
				outside: path.join(root, 'site/public/elsewhere'),
				sibling: path.join(root, 'site/public/uploads-evil'),
				inside: path.join(uploads, 'real'),
				dangling: path.join(root, 'nowhere'),
				loop: 'loop',
			}
			for (const folder of LINKS) await fs.symlink(targets[path.basename(folder)]!, path.join(uploads, folder))
		})

		test('list reads nothing through one, wherever it sits and wherever it points', async () => {
			const before = await tree()
			for (const folder of FOLDERS) {
				expect({ folder, result: await adapter.list({ folder }) }).toEqual({ folder, result: { items: [], folders: [], hasMore: false } })
			}
			expect(await tree()).toEqual(before)
		})

		test('upload writes nothing through one, wherever it sits and wherever it points', async () => {
			const before = await tree()
			for (const folder of FOLDERS) {
				expect({ folder, result: await upload(adapter, folder) }).toEqual({ folder, result: { success: false, error: 'Invalid folder name' } })
			}
			expect(await tree()).toEqual(before)
		})

		test('createFolder creates nothing through one, wherever it sits and wherever it points', async () => {
			const before = await tree()
			for (const folder of FOLDERS) {
				expect({ folder, result: await adapter.createFolder!(folder) }).toEqual({ folder, result: { success: false, error: 'Invalid folder name' } })
			}
			expect(await tree()).toEqual(before)
		})

		test('delete removes nothing through one, wherever it sits and wherever it points', async () => {
			const before = await tree()
			for (const folder of FOLDERS) {
				for (const id of [`${folder}/keep.png`, `${folder}/victim.txt`]) {
					expect({ id, result: await adapter.delete(id) }).toEqual({ id, result: { success: false, error: 'Invalid media id' } })
				}
			}
			expect(await tree()).toEqual(before)
			expectNothingRemoved()
		})

		test('the folders next to the links keep working, and no listing offers a link', async () => {
			expect((await adapter.list()).folders.map(f => f.path)).toEqual(['photos', 'real'])
			expect((await adapter.list({ folder: 'photos' })).folders.map(f => f.path)).toEqual(['photos/2026'])
			expect((await adapter.list({ folder: 'real' })).items.map(i => i.id)).toEqual(['real/keep.png'])

			const uploaded = await upload(adapter, 'photos/2026')
			expect(uploaded.success).toBe(true)
			expect((await adapter.list({ folder: 'photos/2026' })).items.map(i => i.id)).toEqual([uploaded.id!])
			expect(await adapter.delete(uploaded.id!)).toEqual({ success: true })
			expect(await adapter.createFolder!('photos/2026/new')).toEqual({ success: true })
			expectNothingRemoved()
		})

		test('a name that cannot be inspected is never taken for a plain one', async () => {
			const before = await tree()
			const denied = Object.assign(new Error(`EACCES: permission denied, lstat '${uploads}'`), { code: 'EACCES' })
			const lstat = spyOn(fs, 'lstat').mockRejectedValue(denied)
			try {
				expect(await upload(adapter, 'outside')).toEqual({ success: false, error: 'Failed to store media file (EACCES)' })
				expect(await adapter.createFolder!('outside/sub')).toEqual({ success: false, error: 'Failed to create folder (EACCES)' })
				expect(await adapter.delete('outside/keep.png')).toEqual({ success: false, error: 'Failed to delete media file (EACCES)' })
				await expect(adapter.list({ folder: 'outside' })).rejects.toThrow(/^Failed to list media \(EACCES\)$/)
				expect(lstat).toHaveBeenCalled()
			} finally {
				lstat.mockRestore()
			}
			expect(await tree()).toEqual(before)
			expectNothingRemoved()
		})
	})

	describe('uploads directory', () => {
		test('all four operations work when it is itself reached through a symlink', async () => {
			const linkedUploads = path.join(root, 'linked-uploads')
			await fs.symlink(uploads, linkedUploads)
			await link('shared', 'site/public/elsewhere')
			const viaLink = createLocalStorageAdapter({ dir: linkedUploads })

			expect(await viaLink.createFolder!('albums')).toEqual({ success: true })
			const uploaded = await upload(viaLink, 'albums')
			expect(uploaded.success).toBe(true)
			expect(existsSync(path.join(uploads, uploaded.id!))).toBe(true)
			expect((await viaLink.list({ folder: 'albums' })).items.map(i => i.id)).toEqual([uploaded.id!])
			expect(await viaLink.delete(uploaded.id!)).toEqual({ success: true })
			expect(existsSync(path.join(uploads, uploaded.id!))).toBe(false)

			expect(await viaLink.delete('../victim.txt')).toEqual({ success: false, error: 'Invalid media id' })
			expect(await viaLink.delete('shared/victim.txt')).toEqual({ success: false, error: 'Invalid media id' })
			expect(await upload(viaLink, 'shared')).toEqual({ success: false, error: 'Invalid folder name' })
			expectNothingRemoved()
		})

		test('one that does not exist yet is created on first use', async () => {
			const fresh = createLocalStorageAdapter({ dir: path.join(root, 'site/public/not/there/yet') })

			const uploaded = await upload(fresh, 'albums')
			expect(uploaded.success).toBe(true)
			expect(existsSync(path.join(root, 'site/public/not/there/yet', uploaded.id!))).toBe(true)
			expect(await fresh.delete(uploaded.id!)).toEqual({ success: true })
			expect(await fresh.delete('../../../victim.txt')).toEqual({ success: false, error: 'Invalid media id' })
			expectNothingRemoved()
		})

		test('one at a filesystem root resolves the names below it', async () => {
			// Nothing is written: both names are made up, so the walk and the unlink find nothing.
			const atRoot = createLocalStorageAdapter({ dir: path.parse(root).root })
			const nobody = `cms-core-media-local-${path.basename(root)}-nobody`

			expect(await atRoot.delete(`${nobody}.png`)).toEqual({ success: false, error: 'Media file not found' })
			expect(await atRoot.delete(`${nobody}/pic.png`)).toEqual({ success: false, error: 'Media file not found' })
			expect(await atRoot.delete(`../${nobody}.png`)).toEqual({ success: false, error: 'Invalid media id' })
		})

		test.skipIf(process.getuid?.() === 0)('a folder that cannot be read fails without reporting a filesystem path', async () => {
			const locked = path.join(uploads, 'locked')
			await fs.mkdir(locked)
			await fs.chmod(locked, 0o000)
			try {
				await expect(adapter.list({ folder: 'locked' })).rejects.toThrow(/^Failed to list media \(EACCES\)$/)
				expect(await upload(adapter, 'locked')).toEqual({ success: false, error: 'Failed to store media file (EACCES)' })
			} finally {
				await fs.chmod(locked, 0o700)
			}
		})
	})

	// The symlink check looks at each name with `lstat` and the operations then act on the
	// same string, so both have to read a backslash the same way: as part of a name. Bun's
	// `fs.realpath` does not (it takes it for a separator on every platform), which is why
	// nothing here relies on it.
	describe.skipIf(posixOnly)('a backslash in a name', () => {
		test('stays one oddly named folder inside the uploads directory for every operation', async () => {
			const before = await tree()
			const folder = 'x\\..\\..\\made-up'
			expect(await adapter.createFolder!(folder)).toEqual({ success: true })

			const uploaded = await upload(adapter, folder)
			expect(uploaded.id).toBe(`${folder}/${uploaded.filename}`)
			expect((await adapter.list({ folder })).items.map(i => i.id)).toEqual([uploaded.id!])
			expect((await tree()).filter(entry => !before.includes(entry))).toEqual([
				`${UPLOADS}/${folder}`,
				`${UPLOADS}/${folder}/${uploaded.filename}`,
			])

			expect(await adapter.delete(uploaded.id!)).toEqual({ success: true })
			expect((await tree()).filter(entry => !before.includes(entry))).toEqual([`${UPLOADS}/${folder}`])
			expectNothingRemoved()
		})

		test('does not hide a symlink from the check', async () => {
			await link('li\\nk', 'site/public/elsewhere')
			await fs.mkdir(path.join(uploads, 'li'))
			const before = await tree()

			expect(await adapter.list({ folder: 'li\\nk' })).toEqual({ items: [], folders: [], hasMore: false })
			expect(await upload(adapter, 'li\\nk')).toEqual({ success: false, error: 'Invalid folder name' })
			expect(await adapter.createFolder!('li\\nk/sub')).toEqual({ success: false, error: 'Invalid folder name' })
			expect(await adapter.delete('li\\nk/victim.txt')).toEqual({ success: false, error: 'Invalid media id' })
			expect(await tree()).toEqual(before)
			expectNothingRemoved()
		})
	})

	// Windows reads names in ways no file here can show: a backslash separates, a `:` names a
	// drive or a stream, trailing dots and spaces are dropped. The simulation swaps `node:path`
	// and the filesystem for the whole process, so it gets a process of its own.
	test('holds under Windows path rules, simulated', async () => {
		const simulation = path.join(import.meta.dir, 'media-local-win32.sim.ts')
		const child = Bun.spawn([process.execPath, 'test', '--conditions=typescript', simulation], {
			cwd: path.resolve(import.meta.dir, '../../..'),
			stdout: 'pipe',
			stderr: 'pipe',
		})
		const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
		expect({ exitCode, output: exitCode === 0 ? '' : stdout + stderr }).toEqual({ exitCode: 0, output: '' })
		expect(stderr).toContain('4 pass')
	}, 60_000)
})
