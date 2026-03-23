import { describe, expect, test } from 'bun:test'
import { createCanonicalInvalidCheck, createCanonicalMismatchCheck, createCanonicalMissingCheck } from '../../../src/checks/seo/canonical-check'
import { createDescriptionLengthCheck, createDescriptionMissingCheck } from '../../../src/checks/seo/description-check'
import { createHeadingSkipCheck, createMultipleH1Check, createNoH1Check } from '../../../src/checks/seo/heading-hierarchy-check'
import { createImageAltMissingCheck } from '../../../src/checks/seo/image-alt-check'
import { createImageAltQualityCheck } from '../../../src/checks/seo/image-alt-quality-check'
import { createJsonLdInvalidCheck } from '../../../src/checks/seo/json-ld-check'
import { createMetaDuplicateCheck } from '../../../src/checks/seo/meta-duplicates-check'
import { createNoindexDetectedCheck } from '../../../src/checks/seo/noindex-check'
import { createOgDescriptionCheck, createOgImageCheck, createOgTitleCheck } from '../../../src/checks/seo/open-graph-check'
import { createTwitterCardCheck } from '../../../src/checks/seo/twitter-card-check'
import { createViewportMissingCheck } from '../../../src/checks/seo/viewport-check'
import { analyzeHtml } from '../../../src/html-analyzer'
import type { PageCheckContext } from '../../../src/types'

function makeCtx(html: string, pagePath = '/'): PageCheckContext {
	const { root, pageData } = analyzeHtml(html)
	return { pagePath, filePath: '/dist/index.html', distDir: '/dist', html, root, pageData }
}

describe('seo/canonical checks', () => {
	const missing = createCanonicalMissingCheck()
	const invalid = createCanonicalInvalidCheck()
	const mismatch = createCanonicalMismatchCheck()

	test('passes when canonical is valid and matches', () => {
		const ctx = makeCtx('<html><head><link rel="canonical" href="https://example.com/"></head><body></body></html>')
		expect(missing.run(ctx)).toHaveLength(0)
		expect(invalid.run(ctx)).toHaveLength(0)
		expect(mismatch.run(ctx)).toHaveLength(0)
	})

	test('warns when canonical is missing', () => {
		const ctx = makeCtx('<html><head></head><body></body></html>')
		expect(missing.run(ctx)).toHaveLength(1)
	})

	test('errors when canonical is relative', () => {
		const ctx = makeCtx('<html><head><link rel="canonical" href="/about"></head><body></body></html>')
		const results = invalid.run(ctx)
		expect(results).toHaveLength(1)
	})

	test('warns when canonical path mismatches', () => {
		const ctx = makeCtx('<html><head><link rel="canonical" href="https://example.com/other"></head><body></body></html>')
		const results = mismatch.run(ctx)
		expect(results).toHaveLength(1)
	})
})

describe('seo/description checks', () => {
	const missing = createDescriptionMissingCheck()
	const length = createDescriptionLengthCheck(50, 160)

	test('passes with valid description', () => {
		const desc = 'A'.repeat(80)
		const ctx = makeCtx(`<html><head><meta name="description" content="${desc}"></head><body></body></html>`)
		expect(missing.run(ctx)).toHaveLength(0)
		expect(length.run(ctx)).toHaveLength(0)
	})

	test('warns when description is missing', () => {
		const ctx = makeCtx('<html><head></head><body></body></html>')
		expect(missing.run(ctx)).toHaveLength(1)
	})

	test('warns when description is too short', () => {
		const ctx = makeCtx('<html><head><meta name="description" content="Short"></head><body></body></html>')
		expect(length.run(ctx)).toHaveLength(1)
	})

	test('warns when description is too long', () => {
		const desc = 'A'.repeat(200)
		const ctx = makeCtx(`<html><head><meta name="description" content="${desc}"></head><body></body></html>`)
		expect(length.run(ctx)).toHaveLength(1)
	})
})

describe('seo/heading checks', () => {
	const multipleH1 = createMultipleH1Check()
	const noH1 = createNoH1Check()
	const skip = createHeadingSkipCheck()

	test('passes with single h1 and correct hierarchy', () => {
		const ctx = makeCtx('<html><head></head><body><h1>Title</h1><h2>Sub</h2></body></html>')
		expect(multipleH1.run(ctx)).toHaveLength(0)
		expect(noH1.run(ctx)).toHaveLength(0)
		expect(skip.run(ctx)).toHaveLength(0)
	})

	test('warns with multiple h1s', () => {
		const ctx = makeCtx('<html><head></head><body><h1>First</h1><h1>Second</h1></body></html>')
		expect(multipleH1.run(ctx)).toHaveLength(1)
	})

	test('warns with no h1', () => {
		const ctx = makeCtx('<html><head></head><body><h2>Sub only</h2></body></html>')
		expect(noH1.run(ctx)).toHaveLength(1)
	})

	test('detects heading level skip', () => {
		const ctx = makeCtx('<html><head></head><body><h1>Title</h1><h3>Skipped</h3></body></html>')
		expect(skip.run(ctx)).toHaveLength(1)
	})
})

describe('seo/image-alt check', () => {
	const check = createImageAltMissingCheck()

	test('passes when all images have alt', () => {
		const ctx = makeCtx('<html><head></head><body><img src="/a.jpg" alt="Photo"></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('passes for decorative images with alt=""', () => {
		const ctx = makeCtx('<html><head></head><body><img src="/a.jpg" alt=""></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns when alt is missing', () => {
		const ctx = makeCtx('<html><head></head><body><img src="/a.jpg"></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})
})

describe('seo/image-alt-quality check', () => {
	const check = createImageAltQualityCheck()

	test('passes with descriptive alt text', () => {
		const ctx = makeCtx('<html><head></head><body><img src="/a.jpg" alt="Team photo at annual retreat"></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('skips images with missing or empty alt', () => {
		const ctx = makeCtx('<html><head></head><body><img src="/a.jpg"><img src="/b.jpg" alt=""></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns with generic English alt text', () => {
		const ctx = makeCtx('<html><head></head><body><img src="/a.jpg" alt="image"><img src="/b.jpg" alt="photo"></body></html>')
		expect(check.run(ctx)).toHaveLength(2)
	})

	test('warns with generic non-English alt text', () => {
		const ctx = makeCtx('<html lang="cs"><head></head><body><img src="/a.jpg" alt="obrázek"><img src="/b.jpg" alt="foto"></body></html>')
		expect(check.run(ctx)).toHaveLength(2)
	})

	test('uses page lang to scope checks', () => {
		const ctx = makeCtx('<html lang="ko"><head></head><body><img src="/a.jpg" alt="이미지"><img src="/b.jpg" alt="bild"></body></html>')
		const results = check.run(ctx)
		// "이미지" (Korean) should match, "bild" (German) should not match for a Korean page
		expect(results).toHaveLength(1)
	})
})

describe('seo/json-ld check', () => {
	const check = createJsonLdInvalidCheck()

	test('passes with valid JSON-LD', () => {
		const ctx = makeCtx('<html><head><script type="application/ld+json">{"@type":"Organization"}</script></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('errors with invalid JSON-LD', () => {
		const ctx = makeCtx('<html><head><script type="application/ld+json">{bad}</script></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})
})

describe('seo/open-graph checks', () => {
	const ogTitle = createOgTitleCheck()
	const ogDesc = createOgDescriptionCheck()
	const ogImage = createOgImageCheck()

	test('passes when all OG tags present', () => {
		const ctx = makeCtx(`<html><head>
			<meta property="og:title" content="Title">
			<meta property="og:description" content="Desc">
			<meta property="og:image" content="/img.jpg">
		</head><body></body></html>`)
		expect(ogTitle.run(ctx)).toHaveLength(0)
		expect(ogDesc.run(ctx)).toHaveLength(0)
		expect(ogImage.run(ctx)).toHaveLength(0)
	})

	test('warns when OG tags are missing', () => {
		const ctx = makeCtx('<html><head></head><body></body></html>')
		expect(ogTitle.run(ctx)).toHaveLength(1)
		expect(ogDesc.run(ctx)).toHaveLength(1)
		expect(ogImage.run(ctx)).toHaveLength(1)
	})
})

describe('seo/meta-duplicate check', () => {
	const check = createMetaDuplicateCheck()

	test('passes with unique meta tags', () => {
		const ctx = makeCtx(`<html><head>
			<meta name="description" content="Desc">
			<meta name="keywords" content="a,b">
		</head><body></body></html>`)
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns on duplicate meta name', () => {
		const ctx = makeCtx(`<html><head>
			<meta name="description" content="First">
			<meta name="description" content="Second">
		</head><body></body></html>`)
		expect(check.run(ctx)).toHaveLength(1)
	})

	test('allows duplicate og:image (allowlisted)', () => {
		const ctx = makeCtx(`<html><head>
			<meta property="og:image" content="/a.jpg">
			<meta property="og:image" content="/b.jpg">
		</head><body></body></html>`)
		expect(check.run(ctx)).toHaveLength(0)
	})
})

describe('seo/viewport check', () => {
	const check = createViewportMissingCheck()

	test('passes with viewport', () => {
		const ctx = makeCtx('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns without viewport', () => {
		const ctx = makeCtx('<html><head></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})
})

describe('seo/noindex check', () => {
	const check = createNoindexDetectedCheck()

	test('passes without noindex', () => {
		const ctx = makeCtx('<html><head></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('detects noindex', () => {
		const ctx = makeCtx('<html><head><meta name="robots" content="noindex"></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})
})

describe('seo/twitter-card check', () => {
	const check = createTwitterCardCheck()

	test('passes with twitter:card', () => {
		const ctx = makeCtx('<html><head><meta name="twitter:card" content="summary_large_image"></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(0)
	})

	test('warns without twitter:card', () => {
		const ctx = makeCtx('<html><head></head><body></body></html>')
		expect(check.run(ctx)).toHaveLength(1)
	})
})
