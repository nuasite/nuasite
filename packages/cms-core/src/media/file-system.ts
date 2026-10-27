import type { MediaFolderItem, MediaItem, MediaListResult, MediaStorageAdapter } from '@nuasite/cms-types'
import type { CmsFileSystem } from '../fs/types.ts'
import { MEDIA_INVALID_FOLDER, MEDIA_INVALID_ID, MEDIA_NOT_FOUND } from './errors.ts'
import { getFileExtension, mimeFromExt } from './mime.ts'
import { isUnsafeFolder } from './names.ts'

export interface FileSystemStorageOptions {
	/** Directory to store media files in, relative to the filesystem's root. Default: `public/uploads`. */
	dir?: string
	/** URL prefix the files are served under. Default: `/uploads`. */
	urlPrefix?: string
}

/**
 * Written into a folder created empty, since a `CmsFileSystem` has directories only for the files
 * in them. Hidden from listings like every name starting with a dot.
 */
const FOLDER_PLACEHOLDER = '.gitkeep'

/** `a/b` spelled the way ids and folders are handed out, or `null` for anything else. */
function parseNames(value: string): string[] | null {
	const names = value.split('/')
	if (value.includes('\0') || names.some(name => name === '' || name === '.' || name === '..')) return null
	return names
}

function errorMessage(action: string, error: unknown): string {
	const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
	return code ? `Failed to ${action} (${code})` : `Failed to ${action}`
}

/**
 * Media stored in the project itself, through the same `CmsFileSystem` the core edits it with: the
 * counterpart of the local adapter for a host without `node:fs`. Uploads land at
 * `<dir>/<folder>/<uuid>.<ext>` and are listed newest first.
 */
export function createFileSystemStorageAdapter(fs: CmsFileSystem, options: FileSystemStorageOptions = {}): MediaStorageAdapter {
	const dir = (options.dir ?? 'public/uploads').split('/').filter(name => name !== '' && name !== '.').join('/')
	const urlPrefix = (options.urlPrefix ?? '/uploads').replace(/\/$/, '')

	/** The folder option as `a/b` (stray slashes dropped) plus its path under the root; `null` when it names no folder. */
	function resolveFolder(input: string | undefined, use: 'read' | 'write'): { folder: string; path: string } | null {
		const folder = (input ?? '').split('/').filter(Boolean).join('/')
		if (!folder) return { folder, path: dir }
		if (parseNames(folder) === null || (use === 'write' && isUnsafeFolder(folder))) return null
		return { folder, path: `${dir}/${folder}` }
	}

	return {
		staticFiles: { urlPrefix, dir },

		async list(opts) {
			const limit = opts?.limit ?? 50
			const offset = opts?.cursor ? parseInt(opts.cursor, 10) : 0
			const target = resolveFolder(opts?.folder, 'read')
			if (!target) return { items: [], folders: [], hasMore: false }
			try {
				const entries = (await fs.list(target.path)).filter(entry => !entry.name.startsWith('.'))
				const folders: MediaFolderItem[] = entries
					.filter(entry => entry.isDirectory)
					.map(entry => ({ name: entry.name, path: target.folder ? `${target.folder}/${entry.name}` : entry.name }))
					.sort((a, b) => a.name.localeCompare(b.name))
				const files = await Promise.all(
					entries
						.filter(entry => !entry.isDirectory)
						.map(async entry => ({ name: entry.name, stat: await fs.stat(`${target.path}/${entry.name}`) })),
				)
				files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)

				const urlFolder = target.folder ? `/${target.folder}` : ''
				const items: MediaItem[] = files.slice(offset, offset + limit).map(file => {
					const ext = getFileExtension(file.name)
					return {
						id: target.folder ? `${target.folder}/${file.name}` : file.name,
						url: `${urlPrefix}${urlFolder}/${file.name}`,
						filename: file.name,
						contentType: mimeFromExt(ext ? `.${ext}` : ''),
						uploadedAt: new Date(file.stat.mtimeMs).toISOString(),
						folder: target.folder || undefined,
					}
				})
				const hasMore = offset + limit < files.length
				return { items, folders, hasMore, cursor: hasMore ? String(offset + limit) : undefined } satisfies MediaListResult
			} catch (error) {
				// Deliberately without `cause`: whatever renders this error must not get the path back.
				// oxlint-disable-next-line preserve-caught-error
				throw new Error(errorMessage('list media', error))
			}
		},

		async upload(file, filename, _contentType, uploadOpts) {
			const target = resolveFolder(uploadOpts?.folder, 'write')
			if (!target) return { success: false, error: MEDIA_INVALID_FOLDER }
			const ext = getFileExtension(filename)
			const newFilename = `${crypto.randomUUID()}${ext ? `.${ext}` : ''}`
			try {
				await fs.writeBytes(`${target.path}/${newFilename}`, file)
			} catch (error) {
				return { success: false, error: errorMessage('store media file', error) }
			}
			const urlFolder = target.folder ? `/${target.folder}` : ''
			return {
				success: true,
				url: `${urlPrefix}${urlFolder}/${newFilename}`,
				filename: newFilename,
				id: target.folder ? `${target.folder}/${newFilename}` : newFilename,
			}
		},

		async delete(id) {
			if (parseNames(id) === null) return { success: false, error: MEDIA_INVALID_ID }
			const path = `${dir}/${id}`
			try {
				if (!(await fs.exists(path))) return { success: false, error: MEDIA_NOT_FOUND }
				await fs.remove(path)
				return { success: true }
			} catch (error) {
				return { success: false, error: errorMessage('delete media file', error) }
			}
		},

		async createFolder(folder) {
			const target = resolveFolder(folder, 'write')
			if (!target) return { success: false, error: MEDIA_INVALID_FOLDER }
			try {
				if (!(await fs.exists(target.path))) await fs.writeFile(`${target.path}/${FOLDER_PLACEHOLDER}`, '')
				return { success: true }
			} catch (error) {
				return { success: false, error: errorMessage('create folder', error) }
			}
		},
	}
}
