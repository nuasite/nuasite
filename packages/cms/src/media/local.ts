import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { MediaFolderItem, MediaListResult, MediaStorageAdapter, MediaUploadResult } from './types'

export interface LocalStorageOptions {
	/** Directory to store media files (relative to project root or absolute). Default: 'public/uploads' */
	dir?: string
	/** URL prefix for serving files. Default: '/uploads' */
	urlPrefix?: string
}

export function createLocalStorageAdapter(options: LocalStorageOptions = {}): MediaStorageAdapter {
	const dir = path.resolve(options.dir ?? 'public/uploads')
	const urlPrefix = (options.urlPrefix ?? '/uploads').replace(/\/$/, '')

	return {
		staticFiles: { urlPrefix, dir },

		async list(opts) {
			const limit = opts?.limit ?? 50
			const offset = opts?.cursor ? parseInt(opts.cursor, 10) : 0
			const folder = opts?.folder ?? ''

			const targetDir = folder ? path.join(dir, folder) : dir
			await fs.mkdir(targetDir, { recursive: true })

			const entries = await fs.readdir(targetDir, { withFileTypes: true })

			// Collect subfolders
			const folders: MediaFolderItem[] = entries
				.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
				.map((e) => ({
					name: e.name,
					path: folder ? `${folder}/${e.name}` : e.name,
				}))
				.sort((a, b) => a.name.localeCompare(b.name))

			// Collect files
			const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.'))

			// Get stats for sorting by mtime desc
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
		},

		async upload(file, filename, contentType, uploadOpts) {
			const folder = uploadOpts?.folder ?? ''
			const targetDir = folder ? path.join(dir, folder) : dir
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
		},

		async delete(id) {
			// id may contain folder path — resolve safely within dir
			const safePath = id.split('/').map((s) => path.basename(s)).join('/')
			const filePath = path.join(dir, safePath)
			try {
				await fs.unlink(filePath)
				return { success: true }
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				return { success: false, error: message }
			}
		},

		async createFolder(folder) {
			const segments = folder.split('/').filter(Boolean)
			if (segments.some((s) => s === '..' || s === '.')) {
				return { success: false, error: 'Invalid folder name' }
			}
			try {
				await fs.mkdir(path.join(dir, ...segments), { recursive: true })
				return { success: true }
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				return { success: false, error: message }
			}
		},
	}
}

export function getFileExtension(filename: string): string {
	const parts = filename.split('.')
	const ext = parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : ''
	// Only allow alphanumeric extensions to prevent injection
	return /^[a-z0-9]+$/.test(ext) ? ext : ''
}

export const MIME_BY_EXT: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.avif': 'image/avif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.pdf': 'application/pdf',
}

export function mimeFromExt(ext: string): string {
	return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}
