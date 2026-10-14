export function getFileExtension(filename: string): string {
	const parts = filename.split('.')
	const ext = parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : ''
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
