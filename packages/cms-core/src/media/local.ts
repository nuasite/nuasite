import type { MediaFolderItem, MediaListResult, MediaStorageAdapter, MediaUploadResult } from '@nuasite/cms-types'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MEDIA_INVALID_FOLDER, MEDIA_INVALID_ID, MEDIA_NOT_FOUND } from './errors.ts'
import { getFileExtension, mimeFromExt } from './mime.ts'
import { isUnsafeFolder } from './names.ts'

export interface LocalStorageOptions {
	/**
	 * Directory to store media files. Default: 'public/uploads'.
	 *
	 * A relative value is resolved against `process.cwd()`, so pass an absolute path
	 * whenever the process's working directory is not the project root (e.g. the
	 * sidecar started with `--root <dir>`) — otherwise the reported
	 * `staticFiles.dir` points outside the project and consumers cannot tell that
	 * these files already live under it.
	 */
	dir?: string
	/** URL prefix for serving files. Default: '/uploads' */
	urlPrefix?: string
}

/** `error.code` of a filesystem error, when it has one. */
function errorCode(error: unknown): string | undefined {
	return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

/**
 * A filesystem failure as a message: what was attempted and the error code. Never the
 * runtime's own text, which spells out the absolute path.
 */
function failure(action: string, error: unknown): string {
	const code = errorCode(error)
	return code ? `Failed to ${action} (${code})` : `Failed to ${action}`
}

/**
 * Whether one of `names`, each taken below the one before it starting in `from`, is a
 * symbolic link. Nothing here follows a link: every name is looked at with `lstat`,
 * and the walk ends at the first one that is not there, since nothing below it can be
 * either. Any other failure is thrown, so a name that cannot be inspected is never
 * taken for a plain one.
 */
async function hasSymlink(from: string, names: string[]): Promise<boolean> {
	let current = from
	for (const name of names) {
		current += path.sep + name
		try {
			if ((await fs.lstat(current)).isSymbolicLink()) return true
		} catch (error) {
			const code = errorCode(error)
			if (code === 'ENOENT' || code === 'ENOTDIR') return false
			throw error
		}
	}
	return false
}

export function createLocalStorageAdapter(options: LocalStorageOptions = {}): MediaStorageAdapter {
	const dir = path.resolve(options.dir ?? 'public/uploads')
	/** `dir` as the start of every path below it: without the separator a filesystem root ends in. */
	const base = dir.endsWith(path.sep) ? dir.slice(0, -path.sep.length) : dir
	const urlPrefix = (options.urlPrefix ?? '/uploads').replace(/\/$/, '')

	/**
	 * Resolve a caller-supplied id or folder to the path it names inside the uploads
	 * directory, or `null` when it names none. Every operation goes through here before
	 * it touches the filesystem.
	 *
	 * The spelling is the one `list` and `upload` hand out: names joined by `/`, none of
	 * them empty, `.` or `..`, and no NUL in any. Where the backslash separates paths,
	 * three more things make a name something other than what it spells and are refused:
	 * a backslash, a `:` (a drive or a stream), and a trailing dot or space (dropped by
	 * the system). Resolving such a path must change nothing: it is the directory
	 * followed by exactly these names, so it is below the directory.
	 *
	 * None of the names may be a symbolic link, wherever it points, because a link is
	 * the one thing that leads a path below the directory out of it. The exception is
	 * the last name of a file: `unlink` removes a link itself and never what it points
	 * to. The uploads directory and what is above it are the operator's and not looked
	 * at. The check is not atomic with the operation that follows it.
	 */
	async function resolveInside(relative: string, kind: 'file' | 'folder'): Promise<string | null> {
		const segments = relative.split('/')
		if (relative.includes('\0') || segments.some((s) => s === '' || s === '.' || s === '..')) return null
		if (path.sep === '\\' && segments.some((s) => /[\\:]|[. ]$/.test(s))) return null
		const resolved = path.resolve(dir, ...segments)
		if (resolved !== [base, ...segments].join(path.sep)) return null
		if (await hasSymlink(base, kind === 'file' ? segments.slice(0, -1) : segments)) return null
		return resolved
	}

	/**
	 * A `folder` option as the `a/b` spelling ids are built from, plus the directory it
	 * names: the uploads directory itself when empty, `null` when it is not inside it.
	 * Stray slashes are dropped (`/a//b/` is `a/b`), as `createFolder` always did.
	 *
	 * A folder to `write` into must also spell the same path once it is part of a URL
	 * (`isUnsafeFolder`), or the URL handed out for a file in it would address another
	 * one. A folder that already exists under such a name is still listed, so whatever
	 * is in it can be found and deleted.
	 */
	async function resolveFolder(input: string | undefined, use: 'read' | 'write'): Promise<{ folder: string; targetDir: string } | null> {
		const folder = (input ?? '').split('/').filter(Boolean).join('/')
		if (!folder) return { folder, targetDir: dir }
		if (use === 'write' && isUnsafeFolder(folder)) return null
		const targetDir = await resolveInside(folder, 'folder')
		return targetDir ? { folder, targetDir } : null
	}

	return {
		staticFiles: { urlPrefix, dir },

		async list(opts) {
			const limit = opts?.limit ?? 50
			const offset = opts?.cursor ? parseInt(opts.cursor, 10) : 0
			const nothing: MediaListResult = { items: [], folders: [], hasMore: false }
			try {
				const target = await resolveFolder(opts?.folder, 'read')
				if (!target) return nothing
				const { folder, targetDir } = target
				await fs.mkdir(targetDir, { recursive: true })

				const entries = await fs.readdir(targetDir, { withFileTypes: true })

				const folders: MediaFolderItem[] = entries
					.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
					.map((e) => ({
						name: e.name,
						path: folder ? `${folder}/${e.name}` : e.name,
					}))
					.sort((a, b) => a.name.localeCompare(b.name))

				const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.'))

				const withStats = await Promise.all(
					files.map(async (f) => {
						const filePath = path.join(targetDir, f.name)
						const stat = await fs.stat(filePath)
						return { name: f.name, stat }
					}),
				)
				withStats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)

				const slice = withStats.slice(offset, offset + limit)
				const hasMore = offset + limit < withStats.length

				const urlFolder = folder ? `/${folder}` : ''
				const items = slice.map((f) => {
					const ext = path.extname(f.name).toLowerCase()
					const contentType = mimeFromExt(ext)
					return {
						id: folder ? `${folder}/${f.name}` : f.name,
						url: `${urlPrefix}${urlFolder}/${f.name}`,
						filename: f.name,
						contentType,
						uploadedAt: f.stat.mtime.toISOString(),
						folder: folder || undefined,
					}
				})

				return {
					items,
					folders,
					hasMore,
					cursor: hasMore ? String(offset + limit) : undefined,
				} satisfies MediaListResult
			} catch (error) {
				// A name that belongs to a file, or is too long to be one, holds nothing to list.
				const code = errorCode(error)
				if (opts?.folder && (code === 'ENOTDIR' || code === 'EEXIST' || code === 'ENAMETOOLONG')) return nothing
				// Deliberately without `cause`: whatever renders this error must not get the path back.
				// oxlint-disable-next-line preserve-caught-error
				throw new Error(failure('list media', error))
			}
		},

		async upload(file, filename, contentType, uploadOpts) {
			try {
				const target = await resolveFolder(uploadOpts?.folder, 'write')
				if (!target) return { success: false, error: MEDIA_INVALID_FOLDER }
				const { folder, targetDir } = target
				await fs.mkdir(targetDir, { recursive: true })

				const ext = getFileExtension(filename)
				const uuid = randomUUID()
				const newFilename = `${uuid}${ext ? `.${ext}` : ''}`
				const filePath = path.join(targetDir, newFilename)

				await fs.writeFile(filePath, file)

				const urlFolder = folder ? `/${folder}` : ''
				const id = folder ? `${folder}/${newFilename}` : newFilename

				return {
					success: true,
					url: `${urlPrefix}${urlFolder}/${newFilename}`,
					filename: newFilename,
					id,
				} satisfies MediaUploadResult
			} catch (error) {
				return { success: false, error: failure('store media file', error) }
			}
		},

		async delete(id) {
			try {
				const filePath = await resolveInside(id, 'file')
				if (!filePath) return { success: false, error: MEDIA_INVALID_ID }
				await fs.unlink(filePath)
				return { success: true }
			} catch (error) {
				if (errorCode(error) === 'ENOENT') return { success: false, error: MEDIA_NOT_FOUND }
				return { success: false, error: failure('delete media file', error) }
			}
		},

		async createFolder(folder) {
			try {
				const target = await resolveFolder(folder, 'write')
				if (!target) return { success: false, error: MEDIA_INVALID_FOLDER }
				await fs.mkdir(target.targetDir, { recursive: true })
				return { success: true }
			} catch (error) {
				return { success: false, error: failure('create folder', error) }
			}
		},
	}
}
