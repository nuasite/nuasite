import { createNodeFs, scanCollections } from '@nuasite/cms-core'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import * as yaml from 'yaml'

describe('scanCollections: field directives in frontmatter comments', () => {
	let root: string

	beforeEach(async () => {
		root = path.join(import.meta.dir, `__scanner-directives-${Date.now()}-${Math.random().toString(36).slice(2)}__`)
		await fs.mkdir(root, { recursive: true })
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	async function write(files: Record<string, string>): Promise<void> {
		for (const [relative, content] of Object.entries(files)) {
			const target = path.join(root, relative)
			await fs.mkdir(path.dirname(target), { recursive: true })
			await fs.writeFile(target, content)
		}
	}

	test('a comment above a field sets its position and group; other comments set nothing', async () => {
		await write({
			// Directives are merged across entries, so each of these sits in another file.
			'src/content/posts/first.md': '---\n# @position header\ntitle: First\nauthor: Ann\nsubtitle: One\n---\n',
			'src/content/posts/second.md': '---\ntitle: Second\n# @group Credits\nauthor: Bob\nsubtitle: Two\n---\n',
			'src/content/posts/third.md': '---\ntitle: Third\nauthor: Cid\n# reviewed twice\nsubtitle: Three\n---\n',
		})

		const collections = await scanCollections(createNodeFs(root))
		const fields = new Map(collections.posts?.fields.map(field => [field.name, field]))

		expect(fields.get('title')).toMatchObject({ position: 'header', positionDeclared: true })
		expect(fields.get('author')?.group).toBe('Credits')
		expect(fields.get('subtitle')?.position).toBeUndefined()
		expect(fields.get('subtitle')?.group).toBeUndefined()
	})

	test('a frontmatter that names no directive is not parsed for one', async () => {
		await write({
			'src/content/posts/plain.md': '---\ntitle: Plain\n# reviewed twice\nauthor: Ann\n---\n',
			'src/content/posts/other.md': '---\ntitle: Other\nauthor: Bob\n---\n',
		})
		const documents = spyOn(yaml, 'parseDocument')
		try {
			await scanCollections(createNodeFs(root))
			expect(documents).not.toHaveBeenCalled()

			await write({ 'src/content/posts/grouped.md': '---\ntitle: Grouped\n# @group Credits\nauthor: Cid\n---\n' })
			await scanCollections(createNodeFs(root))
			expect(documents).toHaveBeenCalledTimes(1)
		} finally {
			documents.mockRestore()
		}
	})
})
