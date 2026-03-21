import { describe, expect, test } from 'bun:test'
import { createHtmlSizeCheck } from '../../../src/checks/performance/html-size-check'
import { createImageFormatCheck } from '../../../src/checks/performance/image-optimization-check'
import { createInlineSizeCheck } from '../../../src/checks/performance/inline-size-check'
import { createLazyLoadingCheck } from '../../../src/checks/performance/lazy-loading-check'
import { createRenderBlockingScriptCheck } from '../../../src/checks/performance/render-blocking-check'
import { createTotalRequestsCheck } from '../../../src/checks/performance/total-requests-check'
import { analyzeHtml } from '../../../src/html-analyzer'
import type { PageCheckContext } from '../../../src/types'

function makeCtx(html: string, pagePath = '/'): PageCheckContext {
	const { root, pageData } = analyzeHtml(html)
	return { pagePath, filePath: '/dist/index.html', distDir: '/dist', html, root, pageData }
}

describe('performance/html-size check', () => {
	const check = createHtmlSizeCheck(100) // 100 bytes for testing

	test('passes for small HTML', () => {
		const ctx = makeCtx('<html><head></head><body>Hi</body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns for large HTML', () => {
		const bigHtml = `<html><head></head><body>${'x'.repeat(200)}</body></html>`
		const ctx = makeCtx(bigHtml)
		expect(check.run(ctx)).toHaveLength(1)
	})
})

describe('performance/image-format check', () => {
	const check = createImageFormatCheck(['webp', 'avif', 'svg'])

	test('passes for modern formats', () => {
		const ctx = makeCtx('<html><head></head><body><img src="/a.webp" alt=""><img src="/b.avif" alt=""></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns for legacy formats', () => {
		const ctx = makeCtx('<html><head></head><body><img src="/a.jpg" alt=""><img src="/b.png" alt=""></body></html>')
		expect(check.run(ctx)).toHaveLength(2)
	})

	test('skips external URLs', () => {
		const ctx = makeCtx('<html><head></head><body><img src="https://cdn.example.com/img.jpg" alt=""></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('skips data URLs', () => {
		const ctx = makeCtx('<html><head></head><body><img src="data:image/png;base64,abc" alt=""></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})
})

describe('performance/lazy-loading check', () => {
	const check = createLazyLoadingCheck()

	test('passes when below-fold images have lazy loading', () => {
		const ctx = makeCtx(`<html><head></head><body>
			<img src="/a.jpg" alt="">
			<img src="/b.jpg" alt="">
			<img src="/c.jpg" alt="" loading="lazy">
		</body></html>`)
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns for below-fold images without lazy loading', () => {
		const ctx = makeCtx(`<html><head></head><body>
			<img src="/a.jpg" alt="">
			<img src="/b.jpg" alt="">
			<img src="/c.jpg" alt="">
			<img src="/d.jpg" alt="">
		</body></html>`)
		expect(check.run(ctx)).toHaveLength(2) // 3rd and 4th images
	})

	test('skips images with explicit loading="eager"', () => {
		const ctx = makeCtx(`<html><head></head><body>
			<img src="/a.jpg" alt="">
			<img src="/b.jpg" alt="">
			<img src="/c.jpg" alt="" loading="eager">
		</body></html>`)
		expect(check.run(ctx)).toHaveLength(0)
	})
})

describe('performance/render-blocking-script check', () => {
	const check = createRenderBlockingScriptCheck()

	test('passes for async/defer/module scripts', () => {
		const ctx = makeCtx(`<html><head>
			<script src="/a.js" async></script>
			<script src="/b.js" defer></script>
			<script src="/c.js" type="module"></script>
		</head><body></body></html>`)
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns for blocking scripts', () => {
		const ctx = makeCtx('<html><head><script src="/app.js"></script></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})

	test('ignores inline scripts', () => {
		const ctx = makeCtx('<html><head><script>var x = 1;</script></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})
})

describe('performance/inline-size check', () => {
	const check = createInlineSizeCheck(50) // 50 bytes for testing

	test('passes for small inline content', () => {
		const ctx = makeCtx('<html><head><script>x=1</script></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns for large inline content', () => {
		const bigScript = 'x'.repeat(100)
		const ctx = makeCtx(`<html><head><script>${bigScript}</script></head><body></body></html>`)
		expect(check.run(ctx)).toHaveLength(1)
	})
})

describe('performance/total-requests check', () => {
	const check = createTotalRequestsCheck(2) // max 2 for testing

	test('passes under limit', () => {
		const ctx = makeCtx('<html><head><script src="/a.js"></script></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns over limit', () => {
		const ctx = makeCtx(`<html><head>
			<script src="/a.js"></script>
			<script src="/b.js"></script>
			<link rel="stylesheet" href="/c.css">
		</head><body></body></html>`)
		expect(check.run(ctx)).toHaveLength(1)
	})
})
