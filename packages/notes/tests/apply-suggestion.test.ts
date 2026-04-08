import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { type ApplyResult, applySuggestion } from '../src/apply/apply-suggestion'
import type { NoteItem } from '../src/storage/types'

let tempDir: string

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-apply-'))
})

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true })
})

function makeItem(overrides: Partial<NoteItem> = {}): NoteItem {
	return {
		id: 'n-test-001',
		type: 'suggestion',
		targetCmsId: 'cms-0',
		targetSourcePath: 'src/pages/index.astro',
		targetSourceLine: 3,
		body: '',
		author: 'tester',
		createdAt: new Date().toISOString(),
		status: 'open',
		replies: [],
		range: {
			anchorText: 'Hello world',
			originalText: 'Hello world',
			suggestedText: 'Hello universe',
		},
		...overrides,
	}
}

async function writeSource(relativePath: string, content: string): Promise<void> {
	const abs = path.join(tempDir, relativePath)
	await fs.mkdir(path.dirname(abs), { recursive: true })
	await fs.writeFile(abs, content, 'utf-8')
}

describe('applySuggestion', () => {
	test('replaces single occurrence', async () => {
		await writeSource('src/pages/index.astro', '<h1>Hello world</h1>\n<p>Some text</p>')
		const result = await applySuggestion(makeItem(), { projectRoot: tempDir })
		expect(result.ok).toBe(true)
		if (result.ok) {
			const content = await fs.readFile(path.join(tempDir, 'src/pages/index.astro'), 'utf-8')
			expect(content).toContain('Hello universe')
			expect(content).not.toContain('Hello world')
		}
	})

	test('picks nearest occurrence when multiple exist', async () => {
		const source = 'line1\nline2\nHello world\nline4\nHello world\nline6'
		await writeSource('src/pages/index.astro', source)
		const item = makeItem({ targetSourceLine: 3 })
		const result = await applySuggestion(item, { projectRoot: tempDir })
		expect(result.ok).toBe(true)
		if (result.ok) {
			const content = await fs.readFile(path.join(tempDir, 'src/pages/index.astro'), 'utf-8')
			// First occurrence replaced, second preserved
			expect(content).toBe('line1\nline2\nHello universe\nline4\nHello world\nline6')
		}
	})

	test('returns ambiguous when multiple occurrences are all far from targetSourceLine', async () => {
		const lines = Array.from({ length: 50 }, (_, i) => `line${i}`).join('\n')
		const source = `Hello world\n${lines}\nHello world`
		await writeSource('src/pages/index.astro', source)
		const item = makeItem({ targetSourceLine: 25 })
		const result = await applySuggestion(item, { projectRoot: tempDir })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toBe('ambiguous')
	})

	test('returns not-found when original text has drifted', async () => {
		await writeSource('src/pages/index.astro', '<h1>Goodbye world</h1>')
		const result = await applySuggestion(makeItem(), { projectRoot: tempDir })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toBe('not-found')
	})

	test('rejects non-suggestion items', async () => {
		const item = makeItem({ type: 'comment', range: null })
		const result = await applySuggestion(item, { projectRoot: tempDir })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toBe('not-suggestion')
	})

	test('rejects items missing targetSourcePath', async () => {
		const item = makeItem({ targetSourcePath: undefined })
		const result = await applySuggestion(item, { projectRoot: tempDir })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toBe('missing-source')
	})

	test('blocks path traversal', async () => {
		const item = makeItem({ targetSourcePath: '../../etc/passwd' })
		const result = await applySuggestion(item, { projectRoot: tempDir })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toBe('missing-source')
	})

	test('returns file-error when source file does not exist', async () => {
		const item = makeItem({ targetSourcePath: 'src/nonexistent.astro' })
		const result = await applySuggestion(item, { projectRoot: tempDir })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toBe('file-error')
	})

	test('rejects empty originalText', async () => {
		await writeSource('src/pages/index.astro', '<h1>Hello</h1>')
		const item = makeItem({
			range: { anchorText: '', originalText: '', suggestedText: 'world' },
		})
		const result = await applySuggestion(item, { projectRoot: tempDir })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toBe('not-found')
	})

	test('returns before/after context on success', async () => {
		await writeSource('src/pages/index.astro', '<h1>Hello world</h1>')
		const result = await applySuggestion(makeItem(), { projectRoot: tempDir })
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.before).toContain('Hello world')
			expect(result.after).toContain('Hello universe')
			expect(result.file).toBe('src/pages/index.astro')
		}
	})

	test('atomic write does not corrupt on success', async () => {
		await writeSource('src/pages/index.astro', '<h1>Hello world</h1>\n<p>Keep me</p>')
		await applySuggestion(makeItem(), { projectRoot: tempDir })
		const content = await fs.readFile(path.join(tempDir, 'src/pages/index.astro'), 'utf-8')
		expect(content).toBe('<h1>Hello universe</h1>\n<p>Keep me</p>')
	})
})
