import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { MediaListResult, MediaStorageAdapter, MediaUploadResult } from './types'

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

			await fs.mkdir(dir, { recursive: true })

			const entries = await fs.readdir(dir, { withFileTypes: true })
			const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.'))

			// Get stats for sorting by mtime desc
			const withStats = await Promise.all(
				files.map(async (f) => {
					const filePath = path.join(dir, f.name)
					const stat = await fs.stat(filePath)
					return { name: f.name, stat }
				}),
			)
			withStats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)

			const slice = withStats.slice(offset, offset + limit)
			const hasMore = offset + limit < withStats.length

			const items = slice.map((f) => {
				const ext = path.extname(f.name).toLowerCase()
				const contentType = mimeFromExt(ext)
				return {
					id: f.name,
					url: `${urlPrefix}/${f.name}`,
					filename: f.name,
					contentType,
					uploadedAt: f.stat.mtime.toISOString(),
				}
			})

			return {
				items,
				hasMore,
				cursor: hasMore ? String(offset + limit) : undefined,
			} satisfies MediaListResult
		},

		async upload(file, filename, contentType) {
			await fs.mkdir(dir, { recursive: true })

			const ext = getFileExtension(filename)
			const uuid = randomUUID()
			const newFilename = `${uuid}${ext ? `.${ext}` : ''}`
			const filePath = path.join(dir, newFilename)

			await fs.writeFile(filePath, file)

			return {
				success: true,
				url: `${urlPrefix}/${newFilename}`,
				filename: newFilename,
				id: newFilename,
			} satisfies MediaUploadResult
		},

		async delete(id) {
			const filePath = path.join(dir, path.basename(id))
			try {
				await fs.unlink(filePath)
				return { success: true }
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				return { success: false, error: message }
			}
		},
	}
}

function getFileExtension(filename: string): string {
	const parts = filename.split('.')
	const ext = parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : ''
	// Only allow alphanumeric extensions to prevent injection
	return /^[a-z0-9]+$/.test(ext) ? ext : ''
}

function mimeFromExt(ext: string): string {
	const map: Record<string, string> = {
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
	return map[ext] ?? 'application/octet-stream'
}
