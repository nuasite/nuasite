import { describe, expect, test } from 'bun:test'
import { createAriaLandmarksCheck } from '../../../src/checks/accessibility/aria-landmarks-check'
import { createFormLabelCheck } from '../../../src/checks/accessibility/form-label-check'
import { createLangAttributeCheck } from '../../../src/checks/accessibility/lang-attribute-check'
import { createLinkTextCheck } from '../../../src/checks/accessibility/link-text-check'
import { createTabindexCheck } from '../../../src/checks/accessibility/tabindex-check'
import { analyzeHtml } from '../../../src/html-analyzer'
import type { PageCheckContext } from '../../../src/types'

function makeCtx(html: string, pagePath = '/'): PageCheckContext {
	const { root, pageData } = analyzeHtml(html)
	return { pagePath, filePath: '/dist/index.html', distDir: '/dist', html, root, pageData }
}

describe('accessibility/lang-attribute check', () => {
	const check = createLangAttributeCheck()

	test('passes with lang attribute', () => {
		const ctx = makeCtx('<html lang="en"><head></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns without lang attribute', () => {
		const ctx = makeCtx('<html><head></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})
})

describe('accessibility/form-label check', () => {
	const check = createFormLabelCheck()

	test('passes when all inputs have labels', () => {
		const ctx = makeCtx(`<html><head></head><body>
			<form>
				<label for="email">Email</label>
				<input type="email" id="email">
			</form>
		</body></html>`)
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('passes with aria-label', () => {
		const ctx = makeCtx(`<html><head></head><body>
			<form>
				<input type="search" aria-label="Search">
			</form>
		</body></html>`)
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('passes with wrapping label', () => {
		const ctx = makeCtx(`<html><head></head><body>
			<form>
				<label>Name <input type="text"></label>
			</form>
		</body></html>`)
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns when input lacks a label', () => {
		const ctx = makeCtx(`<html><head></head><body>
			<form>
				<input type="text" name="search">
			</form>
		</body></html>`)
		expect(check.run(ctx)).toHaveLength(1)
	})

	test('skips hidden and submit inputs', () => {
		const ctx = makeCtx(`<html><head></head><body>
			<form>
				<input type="hidden" name="csrf">
				<input type="submit" value="Go">
			</form>
		</body></html>`)
		expect(check.run(ctx)).toHaveLength(0)
	})
})

describe('accessibility/aria-landmarks check', () => {
	const check = createAriaLandmarksCheck()

	test('passes with <main> element', () => {
		const ctx = makeCtx('<html><head></head><body><main>Content</main></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('passes with role="main"', () => {
		const ctx = makeCtx('<html><head></head><body><div role="main">Content</div></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns without main landmark', () => {
		const ctx = makeCtx('<html><head></head><body><div>Content</div></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})
})

describe('accessibility/link-text check', () => {
	const check = createLinkTextCheck()

	test('passes with descriptive link text', () => {
		const ctx = makeCtx('<html><head></head><body><a href="/about">About our company</a></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns with generic link text', () => {
		const ctx = makeCtx('<html><head></head><body><a href="/about">click here</a></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})

	test('warns with "read more"', () => {
		const ctx = makeCtx('<html><head></head><body><a href="/post">read more</a></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})

	test('warns with "here"', () => {
		const ctx = makeCtx('<html><head></head><body><a href="/page">here</a></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})
})

describe('accessibility/tabindex check', () => {
	const check = createTabindexCheck()

	test('passes with tabindex="0"', () => {
		const ctx = makeCtx('<html><head></head><body><div tabindex="0">Focusable</div></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('passes with tabindex="-1"', () => {
		const ctx = makeCtx('<html><head></head><body><div tabindex="-1">Programmatic</div></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns with positive tabindex', () => {
		const ctx = makeCtx('<html><head></head><body><div tabindex="5">Bad order</div></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})
})
