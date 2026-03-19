import { describe, expect, test } from 'bun:test'
import { createTitleEmptyCheck, createTitleLengthCheck, createTitleMissingCheck } from '../../../src/checks/seo/title-check'
import { analyzeHtml } from '../../../src/html-analyzer'
import type { PageCheckContext } from '../../../src/types'

function makeCtx(html: string, pagePath = '/'): PageCheckContext {
	const { root, pageData } = analyzeHtml(html)
	return { pagePath, filePath: '/dist/index.html', html, root, pageData }
}

describe('seo/title checks', () => {
	const titleMissing = createTitleMissingCheck()
	const titleEmpty = createTitleEmptyCheck()
	const titleLength = createTitleLengthCheck(60)

	test('passes when title is present and within length', () => {
		const ctx = makeCtx('<html><head><title>Good Title</title></head><body></body></html>')
		expect(titleMissing.run(ctx)).toHaveLength(0)
		expect(titleEmpty.run(ctx)).toHaveLength(0)
		expect(titleLength.run(ctx)).toHaveLength(0)
	})

	test('fails when title is missing', () => {
		const ctx = makeCtx('<html><head></head><body></body></html>')
		const results = titleMissing.run(ctx)
		expect(results).toHaveLength(1)
		expect(results[0]?.checkId).toBe('seo/title-missing')
		expect(results[0]?.severity).toBe('error')
	})

	test('warns when title is too long', () => {
		const longTitle = 'A'.repeat(70)
		const ctx = makeCtx(`<html><head><title>${longTitle}</title></head><body></body></html>`)
		const results = titleLength.run(ctx)
		expect(results).toHaveLength(1)
		expect(results[0]?.severity).toBe('warning')
		expect(results[0]?.actual).toBe(longTitle)
	})

	test('passes when title is exactly at max length', () => {
		const title = 'A'.repeat(60)
		const ctx = makeCtx(`<html><head><title>${title}</title></head><body></body></html>`)
		expect(titleLength.run(ctx)).toHaveLength(0)
	})
})
