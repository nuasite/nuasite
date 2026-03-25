import { statSync } from 'node:fs'
import path from 'node:path'
import type { Check, CheckIssue, PageCheckContext } from '../../types'

function isExternalOrDataUrl(src: string): boolean {
	return src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')
}

export function createImageFormatCheck(allowedFormats: string[]): Check {
	return {
		kind: 'page',
		id: 'performance/image-format',
		name: 'Image Format',
		domain: 'performance',
		defaultSeverity: 'info',
		description: `Images should use modern formats: ${allowedFormats.join(', ')}`,
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			const results: CheckIssue[] = []
			for (const img of ctx.pageData.images) {
				if (isExternalOrDataUrl(img.src)) continue
				const ext = path.extname(img.src).toLowerCase().replace('.', '')
				if (ext && !allowedFormats.includes(ext)) {
					results.push({
						message: `Image "${img.src}" uses .${ext} format instead of a modern format`,
						suggestion: `Convert to ${allowedFormats.join(' or ')} for better compression`,
						line: img.line,
						actual: ext,
						expected: allowedFormats.join(', '),
					})
				}
			}
			return results
		},
	}
}

export function createImageSizeCheck(maxSize: number): Check {
	const sizeCache = new Map<string, number | null>()
	return {
		kind: 'page',
		id: 'performance/image-size',
		name: 'Image File Size',
		domain: 'performance',
		defaultSeverity: 'warning',
		description: `Image files should be under ${(maxSize / 1024).toFixed(0)} KB`,
		essential: false,
		run(ctx: PageCheckContext): CheckIssue[] {
			const results: CheckIssue[] = []
			for (const img of ctx.pageData.images) {
				if (isExternalOrDataUrl(img.src)) continue
				const imgPath = img.src.startsWith('/')
					? path.join(ctx.distDir, img.src)
					: path.resolve(path.dirname(ctx.filePath), img.src)
				let size: number | null
				if (sizeCache.has(imgPath)) {
					size = sizeCache.get(imgPath)!
				} else {
					try {
						size = statSync(imgPath).size
					} catch {
						size = null
					}
					sizeCache.set(imgPath, size)
				}
				if (size === null) continue
				if (size > maxSize) {
					const actualKB = (size / 1024).toFixed(1)
					const maxKB = (maxSize / 1024).toFixed(1)
					results.push({
						message: `Image "${img.src}" is ${actualKB} KB (max: ${maxKB} KB)`,
						suggestion: 'Compress the image or use a smaller resolution',
						line: img.line,
						actual: `${actualKB} KB`,
						expected: `<= ${maxKB} KB`,
					})
				}
			}
			return results
		},
	}
}
