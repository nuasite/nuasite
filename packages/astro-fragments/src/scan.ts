import { parse as parseHtml } from 'node-html-parser'
import fs from 'node:fs/promises'
import path from 'node:path'

import { mapWithConcurrency } from './concurrency.ts'

export interface ScannedPlaceholder {
	pageFile: string
	id: string
}

export async function scanDistForPlaceholders(distDir: string, outputDir: string, concurrency: number): Promise<ScannedPlaceholder[]> {
	const skip = path.resolve(distDir, outputDir)
	const pages = (await fs.readdir(distDir, { recursive: true, withFileTypes: true }))
		.filter(entry => entry.isFile() && entry.name.endsWith('.html'))
		.map(entry => path.join(entry.parentPath, entry.name))
		.filter(filePath => !filePath.startsWith(skip + path.sep))

	const perPage = await mapWithConcurrency(pages, concurrency, async filePath => {
		const html = await fs.readFile(filePath, 'utf8')
		if (!html.includes('<x-fragment')) return []
		const relPath = path.relative(distDir, filePath).split(path.sep).join('/')
		return parseHtml(html, { lowerCaseTagName: false, comment: false }).querySelectorAll('x-fragment').map(node => {
			const id = node.getAttribute('id')
			if (!id) {
				throw new Error(`<x-fragment> in ${relPath} has no id attribute.`)
			}
			return { pageFile: relPath, id }
		})
	})
	return perPage.flat()
}
