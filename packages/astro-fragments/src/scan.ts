import { parse as parseHtml } from 'node-html-parser'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface ScannedPlaceholder {
	pageFile: string
	id: string
}

export async function scanDistForPlaceholders(distDir: string, outputDir: string): Promise<ScannedPlaceholder[]> {
	const placeholders: ScannedPlaceholder[] = []
	const skip = path.resolve(distDir, outputDir)

	await walk(distDir, async filePath => {
		if (filePath.startsWith(skip + path.sep) || filePath === skip) return
		if (!filePath.endsWith('.html')) return
		const html = await fs.readFile(filePath, 'utf8')
		const doc = parseHtml(html, { lowerCaseTagName: false, comment: false })
		const found = doc.querySelectorAll('x-fragment')
		const relPath = path.relative(distDir, filePath).split(path.sep).join('/')
		for (const node of found) {
			const id = node.getAttribute('id')
			if (!id) {
				throw new Error(`<x-fragment> in ${relPath} has no id attribute.`)
			}
			placeholders.push({ pageFile: relPath, id })
		}
	})

	return placeholders
}

async function walk(dir: string, visit: (filePath: string) => Promise<void>): Promise<void> {
	const entries = await fs.readdir(dir, { withFileTypes: true })
	await Promise.all(entries.map(async entry => {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			await walk(full, visit)
		} else if (entry.isFile()) {
			await visit(full)
		}
	}))
}
