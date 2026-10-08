// A simulation, not Windows. It runs the real local adapter with `node:path` swapped for
// `path.win32` and with a filesystem that only records what reaches it, so it pins what
// the adapter decides under Windows path rules and which paths it would then act on. How
// a Windows host treats those paths is not exercised.
//
// Both swaps are process-wide, so this file is not a `*.test.ts`: `media-local.test.ts`
// runs it in a process of its own.
import { beforeEach, expect, mock, test } from 'bun:test'
import nodePath from 'node:path'

const win = nodePath.win32
const UPLOADS = 'C:\\site\\public\\uploads'

/** What exists, by the exact path it is asked for. */
const disk = new Map<string, 'dir' | 'file' | 'link'>()
/** Every call that reached the filesystem, as `<operation> <path>`. */
const calls: string[] = []

function reach(operation: string, target: string): 'dir' | 'file' | 'link' | undefined {
	calls.push(`${operation} ${target.replace(/[0-9a-f-]{36}/, '<uuid>')}`)
	return disk.get(target)
}
const missing = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
const recordingFs = {
	async lstat(target: string) {
		const kind = reach('lstat', target)
		if (kind === undefined) throw missing()
		return { isSymbolicLink: () => kind === 'link' }
	},
	async mkdir(target: string) {
		reach('mkdir', target)
	},
	async readdir(target: string) {
		reach('readdir', target)
		return []
	},
	async writeFile(target: string) {
		reach('writeFile', target)
	},
	async unlink(target: string) {
		if (reach('unlink', target) === undefined) throw missing()
	},
}

void mock.module('node:path', () => ({ ...win, default: win }))
void mock.module('node:fs/promises', () => ({ ...recordingFs, default: recordingFs }))
const { createLocalStorageAdapter } = await import('../src/media/local')

/** The calls that read or change something, without the `lstat` walk in front of them. */
const acted = () => calls.filter(call => !call.startsWith('lstat '))
const upload = (adapter: ReturnType<typeof createLocalStorageAdapter>, folder: string) =>
	adapter.upload(Buffer.from('x'), 'pic.png', 'image/png', { folder })

beforeEach(() => {
	disk.clear()
	calls.length = 0
	for (const folder of ['C:\\site', 'C:\\site\\public', UPLOADS, `${UPLOADS}\\photos`]) disk.set(folder, 'dir')
	disk.set(`${UPLOADS}\\photos\\keep.png`, 'file')
})

test('an id or folder becomes the uploads directory followed by its names', async () => {
	const adapter = createLocalStorageAdapter({ dir: UPLOADS })

	expect(await adapter.createFolder!('photos/2026')).toEqual({ success: true })
	const uploaded = await upload(adapter, 'photos')
	expect(uploaded.id).toBe(`photos/${uploaded.filename}`)
	expect(await adapter.list({ folder: 'photos' })).toEqual({ items: [], folders: [], hasMore: false, cursor: undefined })
	expect(await adapter.delete('photos/keep.png')).toEqual({ success: true })

	expect(acted()).toEqual([
		`mkdir ${UPLOADS}\\photos\\2026`,
		`mkdir ${UPLOADS}\\photos`,
		`writeFile ${UPLOADS}\\photos\\<uuid>.png`,
		`mkdir ${UPLOADS}\\photos`,
		`readdir ${UPLOADS}\\photos`,
		`unlink ${UPLOADS}\\photos\\keep.png`,
	])
})

test('a name Windows would read as something else never reaches the filesystem', async () => {
	const adapter = createLocalStorageAdapter({ dir: UPLOADS })
	disk.set(`${UPLOADS}\\shared`, 'link')
	const names = [
		// A backslash separates: the walk would see one name where the system sees several.
		'photos\\keep.png',
		'shared\\victim.txt',
		'..\\..\\victim.txt',
		'\\\\server\\share',
		// A drive, or a stream of another file or folder.
		'D:x',
		'C:x',
		'C:',
		'ab:cd',
		'keep.png::$DATA',
		'photos::$INDEX_ALLOCATION',
		// Trailing dots and spaces are dropped, so these are `..`, `.`, `photos` and `keep.png`.
		'.. ',
		'. ',
		'.. .',
		'...',
		'photos.',
		'photos ',
		'keep.png.',
	]
	for (const name of names) {
		for (const spelled of [name, `photos/${name}`, `${name}/keep.png`]) {
			expect({ spelled, result: await adapter.delete(spelled) }).toEqual({ spelled, result: { success: false, error: 'Invalid media id' } })
			expect({ spelled, result: await adapter.list({ folder: spelled }) }).toEqual({ spelled, result: { items: [], folders: [], hasMore: false } })
			expect({ spelled, result: await upload(adapter, spelled) }).toEqual({ spelled, result: { success: false, error: 'Invalid folder name' } })
			expect({ spelled, result: await adapter.createFolder!(spelled) }).toEqual({
				spelled,
				result: { success: false, error: 'Invalid folder name' },
			})
		}
	}
	expect(calls).toEqual([])
})

test('a symlinked folder is found by its Windows path and refused', async () => {
	const adapter = createLocalStorageAdapter({ dir: UPLOADS })
	disk.set(`${UPLOADS}\\shared`, 'link')
	disk.set(`${UPLOADS}\\photos\\shared`, 'link')

	for (const folder of ['shared', 'shared/sub', 'photos/shared', 'photos/shared/sub']) {
		expect(await adapter.delete(`${folder}/victim.txt`)).toEqual({ success: false, error: 'Invalid media id' })
		expect(await adapter.list({ folder })).toEqual({ items: [], folders: [], hasMore: false })
		expect(await upload(adapter, folder)).toEqual({ success: false, error: 'Invalid folder name' })
		expect(await adapter.createFolder!(folder)).toEqual({ success: false, error: 'Invalid folder name' })
	}
	expect(acted()).toEqual([])
	expect(calls).toContain(`lstat ${UPLOADS}\\shared`)
	expect(calls).toContain(`lstat ${UPLOADS}\\photos\\shared`)
})

test('an uploads directory at a drive root works like any other', async () => {
	const adapter = createLocalStorageAdapter({ dir: 'C:\\' })
	disk.set('C:\\photos', 'dir')
	disk.set('C:\\photos\\keep.png', 'file')
	disk.set('C:\\shared', 'link')

	expect(await adapter.delete('photos/keep.png')).toEqual({ success: true })
	expect(await adapter.createFolder!('photos/2026')).toEqual({ success: true })
	expect(calls).toEqual(['lstat C:\\photos', 'unlink C:\\photos\\keep.png', 'lstat C:\\photos', 'lstat C:\\photos\\2026', 'mkdir C:\\photos\\2026'])

	expect(await adapter.delete('shared/victim.txt')).toEqual({ success: false, error: 'Invalid media id' })
	expect(await adapter.delete('../victim.txt')).toEqual({ success: false, error: 'Invalid media id' })
	expect(acted()).toEqual(['unlink C:\\photos\\keep.png', 'mkdir C:\\photos\\2026'])
})
