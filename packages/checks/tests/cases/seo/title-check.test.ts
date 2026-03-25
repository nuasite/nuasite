import { describe, expect, test } from 'bun:test'
import { createTitleEmptyCheck, createTitleLengthCheck, createTitleMissingCheck } from '../../../src/checks/seo/title-check'
import { analyzeHtml } from '../../../src/html-analyzer'
import type { PageCheckContext } from '../../../src/types'

function makeCtx(html: string, pagePath = '/'): PageCheckContext {
	const { root, pageData } = analyzeHtml(html)
	return { pagePath, filePath: '/dist/index.html', distDir: '/dist', html, root, pageData }
}

describe('seo/title checks', () => {
	const titleMissing = createTitleMissingCheck()
	const titleEmpty = createTitleEmptyCheck()
	const titleLength = createTitleLengthCheck(60)

	test('passes when title is present and within length', async () => {
		const ctx = makeCtx('<html><head><title>Good Title</title></head><body></body></html>')
		expect(await titleMissing.run(ctx)).toHaveLength(0)
		expect(await titleEmpty.run(ctx)).toHaveLength(0)
		expect(await titleLength.run(ctx)).toHaveLength(0)
	})

	test('fails when title is missing', async () => {
		const ctx = makeCtx('<html><head></head><body></body></html>')
		const results = await titleMissing.run(ctx)
		expect(results).toHaveLength(1)
		expect(results[0]?.message).toContain('missing')
	})

	test('fails when title is empty (whitespace only)', async () => {
		const ctx = makeCtx('<html><head><title>   </title></head><body></body></html>')
		expect(await titleMissing.run(ctx)).toHaveLength(0)
		const results = await titleEmpty.run(ctx)
		expect(results).toHaveLength(1)
		expect(results[0]?.message).toContain('empty')
	})

	test('warns when title is too long', async () => {
		const longTitle = 'A'.repeat(70)
		const ctx = makeCtx(`<html><head><title>${longTitle}</title></head><body></body></html>`)
		const results = await titleLength.run(ctx)
		expect(results).toHaveLength(1)
		expect(results[0]?.actual).toBe(longTitle)
	})

	test('passes when title is exactly at max length', async () => {
		const title = 'A'.repeat(60)
		const ctx = makeCtx(`<html><head><title>${title}</title></head><body></body></html>`)
		expect(await titleLength.run(ctx)).toHaveLength(0)
	})
})
