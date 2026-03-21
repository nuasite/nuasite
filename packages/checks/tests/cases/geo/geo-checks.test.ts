import { describe, expect, test } from 'bun:test'
import { createContentTooShortCheck, createInsufficientHeadingsCheck } from '../../../src/checks/geo/content-quality-check'
import { analyzeHtml } from '../../../src/html-analyzer'
import type { PageCheckContext } from '../../../src/types'

function makeCtx(html: string, pagePath = '/'): PageCheckContext {
	const { root, pageData } = analyzeHtml(html)
	return { pagePath, filePath: '/dist/index.html', distDir: '/dist', html, root, pageData }
}

describe('geo/content-too-short check', () => {
	const check = createContentTooShortCheck(50) // 50 chars for testing

	test('passes with enough content', () => {
		const content = 'A'.repeat(60)
		const ctx = makeCtx(`<html><head></head><body>${content}</body></html>`)
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns with too little content', () => {
		const ctx = makeCtx('<html><head></head><body>Short</body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})
})

describe('geo/insufficient-headings check', () => {
	const check = createInsufficientHeadingsCheck(2)

	test('passes with enough headings', () => {
		const ctx = makeCtx('<html><head></head><body><h1>Title</h1><h2>Sub</h2></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns with too few headings', () => {
		const ctx = makeCtx('<html><head></head><body><h1>Only one</h1></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})
})
