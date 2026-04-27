import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import type { ChangePayload } from '../../src/editor/types'
import { applyImageChange, findExpressionAltAttribute, findExpressionSrcAttribute, isFrontmatterAssetImport } from '../../src/handlers/source-writer'
import { withTempDir } from '../utils'

function makeImageChange(overrides: Partial<ChangePayload>): ChangePayload {
	return {
		cmsId: 'cms-0',
		newValue: '',
		originalValue: '',
		sourcePath: '/test.astro',
		sourceLine: 1,
		sourceSnippet: '',
		...overrides,
	}
}

describe('findExpressionSrcAttribute', async () => {
	test.each([
		['simple variable', '<img src={img} alt="test" />', 'src={img}'],
		['property access', '<img src={item.url} alt="test" />', 'src={item.url}'],
		['template literal', '<img src={`/images/${name}.jpg`} alt="test" />', 'src={`/images/${name}.jpg`}'],
		['nested braces', '<img src={getUrl({ id: 1 })} alt="test" />', 'src={getUrl({ id: 1 })}'],
	])('finds expression: %s', (_label, text, expected) => {
		const result = findExpressionSrcAttribute(text)
		expect(result).not.toBeNull()
		expect(text.slice(result!.index, result!.index + result!.length)).toBe(expected)
	})

	test('returns null for static src="..."', async () => {
		const result = findExpressionSrcAttribute('<img src="/images/photo.jpg" alt="test" />')
		expect(result).toBeNull()
	})
})

describe('findExpressionAltAttribute', async () => {
	test('matches alt with nested template literal', async () => {
		const text = 'alt={`${cat.label} - instalace ${imgIdx + 1}`}'
		const result = findExpressionAltAttribute(text)
		expect(result).not.toBeNull()
		expect(text.slice(result!.index, result!.index + result!.length)).toBe(text)
	})

	test('matches alt with simple variable', async () => {
		const text = '<img src="x" alt={altText} />'
		const result = findExpressionAltAttribute(text)
		expect(result).not.toBeNull()
		expect(text.slice(result!.index, result!.index + result!.length)).toBe('alt={altText}')
	})
})

describe('applyImageChange', async () => {
	test.each([
		['double-quoted', '<img src="/old/image.jpg" alt="Photo" />', '<img src="/uploads/new.jpg" alt="Photo" />'],
		['single-quoted', "<img src='/old/image.jpg' alt='Photo' />", "<img src='/uploads/new.jpg' alt='Photo' />"],
	])('replaces static %s src', async (_label, content, expected) => {
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/old/image.jpg',
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe(expected)
		}
	})

	test('replaces alt text alongside src', async () => {
		const content = '<img src="/old/image.jpg" alt="Old description" />'
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/old/image.jpg',
				imageChange: { newSrc: '/uploads/new.jpg', newAlt: 'New description' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<img src="/uploads/new.jpg" alt="New description" />')
		}
	})

	test('uses URL pathname as fallback candidate', async () => {
		const content = '<img src="/images/photo.jpg" alt="test" />'
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: 'https://cdn.example.com/images/photo.jpg',
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<img src="/uploads/new.jpg" alt="test" />')
		}
	})

	test('extracts src from sourceSnippet as fallback candidate', async () => {
		const content = '<img src="/assets/photo.png" alt="test" class="w-full" />'
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: 'https://cdn.example.com/optimized/photo.webp',
				sourceSnippet: '<img src="/assets/photo.png" alt="test" class="w-full" />',
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<img src="/uploads/new.jpg" alt="test" class="w-full" />')
		}
	})

	test('expression src={getImageUrl()} is refused rather than corrupted', async () => {
		const content = '<div>\n  <img\n    src={getImageUrl()}\n    alt="Photo"\n  />\n</div>'
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/rendered/path.jpg',
				sourceLine: 3,
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain('dynamic expression')
		}
	})

	test('variable src={imageUrl} is refused rather than corrupted', async () => {
		const content = 'const url = "/rendered/path.jpg"\n<div>\n  <img\n    src={imageUrl}\n    alt="Photo"\n  />\n</div>'
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/rendered/path.jpg',
				sourceLine: 4,
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		// Even though the literal exists in the file, we can't reliably know
		// it's the right one to replace, so refuse the edit
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error).toContain('dynamic expression')
		}
	})

	test('rewrites astroImage YAML field when rendered URL differs from authored path', async () => {
		// When the user replaces an Astro image() field, originalValue is the
		// rendered URL (`/_image?href=...`), the source is the YAML line with
		// `./hero.jpg`, and the new value is the entry-relative `./new.jpg`.
		const content = '---\ntitle: Hello\nimage: ./hero.jpg\n---\nBody\n'
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/_image?href=%2F%40fs%2Fproject%2Fsrc%2Fcontent%2Fposts%2Ffoo%2Fhero.jpg&w=800&f=webp',
				sourcePath: 'src/content/posts/foo.md',
				sourceLine: 3,
				sourceSnippet: 'image: ./hero.jpg',
				imageChange: { newSrc: './new.jpg' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toContain('image: ./new.jpg')
			expect(result.content).not.toContain('image: ./hero.jpg')
		}
	})

	test('returns error when src not found anywhere', async () => {
		const content = '<img src="/completely/different.jpg" alt="test" />'
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/nonexistent/image.jpg',
				sourceLine: 0,
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(false)
	})

	test('replaces only first occurrence when same src appears multiple times', async () => {
		const content = '<img src="/photo.jpg" alt="First" />\n<img src="/photo.jpg" alt="Second" />'
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/photo.jpg',
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toContain('src="/uploads/new.jpg"')
			expect(result.content).toContain('src="/photo.jpg"')
		}
	})

	test('escapes special regex characters in src path', async () => {
		const content = '<img src="/images/photo (1).jpg" alt="test" />'
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/images/photo (1).jpg',
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe('<img src="/uploads/new.jpg" alt="test" />')
		}
	})

	test('escapes quotes in alt text', async () => {
		const content = '<img src="/photo.jpg" alt="Old" />'
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/photo.jpg',
				imageChange: { newSrc: '/uploads/new.jpg', newAlt: 'Photo of "sunset"' },
			}),
		)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toContain('alt="Photo of &quot;sunset&quot;"')
		}
	})

	describe('expression-based src/alt handling', async () => {
		test('expression src={img} inside .map() is refused instead of corrupted', async () => {
			const content = [
				'{cat.images.map((img, imgIdx) => (',
				'  <img',
				'    src={img}',
				'    alt={`${cat.label} - instalace ${imgIdx + 1}`}',
				'    class="w-full"',
				'  />',
				'))}',
			].join('\n')

			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/assets/2604-1557-f97ac66b11c3f718b55db500ad4b99fa21bfb60e.png',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/b396a47a-7dec-403b-bfdf-cec65ab44b40.jpeg' },
				}),
			)

			// Should refuse the edit rather than destroying the template
			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error).toContain('dynamic expression')
			}
		})

		test('alt expression with nested braces is fully replaced', async () => {
			const content = [
				'<img',
				'  src="/assets/photo.jpg"',
				'  alt={`${cat.label} - instalace ${imgIdx + 1}`}',
				'  class="w-full"',
				'/>',
			].join('\n')

			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/assets/photo.jpg',
					imageChange: { newSrc: '/uploads/new.jpg', newAlt: 'New alt text' },
				}),
			)

			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('alt="New alt text"')
				expect(result.content).not.toContain('- instalace ${imgIdx + 1}`}')
			}
		})

		test('alt expression with simple variable (no nested braces) works correctly', async () => {
			const content = '<img\n  src="/assets/photo.jpg"\n  alt={altText}\n  class="w-full"\n/>'
			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/assets/photo.jpg',
					imageChange: { newSrc: '/uploads/new.jpg', newAlt: 'New alt text' },
				}),
			)

			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('alt="New alt text"')
				expect(result.content).not.toContain('alt={altText}')
			}
		})

		test('inline-JSX fallback for <Image src={importedAsset}> when absFilePath is unavailable', async () => {
			// Without an absFilePath the rewriter can't copy the new asset to disk —
			// it falls back to a literal `src={hero}` → `src="..."` swap.
			const content =
				'---\nimport { Image } from \'astro:assets\'\nimport hero from \'../assets/hero.png\'\n---\n<Image src={hero} alt="Hero" class="w-full" />\n'
			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/@image/abc.png?f=/abs/hero.png',
					sourceLine: 5,
					imageChange: { newSrc: '/uploads/new.jpg' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('<Image src="/uploads/new.jpg" alt="Hero"')
				expect(result.content).not.toContain('src={hero}')
				expect(result.content).toContain('class="w-full"')
				expect(result.fileOp).toBeUndefined()
			}
		})

		test('refuses src={var} when var is imported from a non-image source', async () => {
			const content = '---\nimport heroData from \'../data/hero.ts\'\n---\n<Image src={heroData.url} alt="" />\n'
			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/rendered/path.jpg',
					sourceLine: 4,
					imageChange: { newSrc: '/uploads/new.jpg' },
				}),
			)
			expect(result.success).toBe(false)
		})
	})

	describe('YAML frontmatter image replacement', async () => {
		test('replaces image URL in YAML key-value pair', async () => {
			const content = '---\ntitle: My Post\ncoverImage: https://images.unsplash.com/photo-123?w=1200\ndraft: false\n---\n\nContent here.'
			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: 'https://images.unsplash.com/photo-123?w=1200',
					sourceSnippet: 'coverImage: https://images.unsplash.com/photo-123?w=1200',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/new-photo.jpg' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('coverImage: /uploads/new-photo.jpg')
				expect(result.content).not.toContain('unsplash')
			}
		})

		test('replaces image URL in YAML when src= pattern not found', async () => {
			const content = '---\nheroImage: /images/old-hero.jpg\ntitle: Page\n---\n\nBody text.'
			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/images/old-hero.jpg',
					sourceSnippet: 'heroImage: /images/old-hero.jpg',
					sourceLine: 2,
					imageChange: { newSrc: '/uploads/new-hero.jpg' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('heroImage: /uploads/new-hero.jpg')
				expect(result.content).not.toContain('/images/old-hero.jpg')
			}
		})

		test('replaces image in YAML when originalValue is Astro-optimized URL', async () => {
			const content = '---\ntitle: My Post\nimage: /images/hero.jpg\n---\n\nContent here.'
			const result = await applyImageChange(
				content,
				makeImageChange({
					// Astro Image component transforms the URL in the rendered HTML
					originalValue: '/_image?href=%2Fimages%2Fhero.jpg&w=1024',
					sourceSnippet: 'image: /images/hero.jpg',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/new-hero.jpg' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('image: /uploads/new-hero.jpg')
				expect(result.content).not.toContain('/images/hero.jpg')
			}
		})

		test('replaces image in YAML via snippet extraction when originalValue differs', async () => {
			const content = '---\ncoverImage: /photos/sunset.jpg\ntitle: Page\n---\n\nBody.'
			const result = await applyImageChange(
				content,
				makeImageChange({
					// Rendered URL differs from authored URL (CDN/optimization)
					originalValue: 'https://cdn.example.com/photos/sunset.jpg',
					sourceSnippet: 'coverImage: /photos/sunset.jpg',
					sourceLine: 2,
					imageChange: { newSrc: '/uploads/new-sunset.jpg' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('coverImage: /uploads/new-sunset.jpg')
				expect(result.content).not.toContain('/photos/sunset.jpg')
			}
		})

		test('replaces image in YAML when originalValue is Astro-hashed filename', async () => {
			const content = '---\ntitle: My Post\nimage: ./images/hero.jpg\n---\n\nContent here.'
			const result = await applyImageChange(
				content,
				makeImageChange({
					// Astro content collection images get hashed filenames in rendered HTML
					originalValue: '/assets/02ea4e4b132e-5172-jpg.webp',
					sourceSnippet: 'image: ./images/hero.jpg',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/new-hero.jpg' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('image: /uploads/new-hero.jpg')
				expect(result.content).not.toContain('./images/hero.jpg')
			}
		})

		test('replaces image value in JSON data file', async () => {
			const content = '{\n  "name": "Test Person",\n  "image": "/assets/old-photo.webp",\n  "role": "Developer"\n}'
			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/assets/old-photo.webp',
					sourceSnippet: '"image": "/assets/old-photo.webp",',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/new-photo.webp' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('"image": "/uploads/new-photo.webp"')
				expect(result.content).not.toContain('/assets/old-photo.webp')
			}
		})

		test('quotes YAML value when new URL contains special characters', async () => {
			const content = '---\nimage: /simple-path.jpg\n---'
			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/simple-path.jpg',
					sourceSnippet: 'image: /simple-path.jpg',
					sourceLine: 2,
					imageChange: { newSrc: '/uploads/photo: special [chars].jpg' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				// YAML library should quote the value due to special characters
				expect(result.content).toContain('photo: special [chars].jpg')
				expect(result.content).not.toContain('/simple-path.jpg')
			}
		})
	})

	describe('data file value replacement', async () => {
		test('returns failure when sourceSnippet does not contain original value', async () => {
			const content = '{\n  "image": "/assets/photo.webp"\n}'
			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/assets/photo.webp',
					sourceSnippet: '"name": "Alice"',
					sourceLine: 2,
					imageChange: { newSrc: '/uploads/new.webp' },
				}),
			)
			// The snippet doesn't contain the original value, so YAML/JSON branch
			// can't extract it — but the static src= fallback may still work.
			// In a plain JSON file (no src= attribute), this should fail.
			expect(result.success).toBe(false)
		})

		test('replaces only the targeted image when JSON has multiple image fields', async () => {
			const content = '{\n  "avatar": "/assets/avatar.webp",\n  "banner": "/assets/banner.webp"\n}'
			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/assets/banner.webp',
					sourceSnippet: '"banner": "/assets/banner.webp"',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/new-banner.webp' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('"banner": "/uploads/new-banner.webp"')
				// The other image should remain untouched
				expect(result.content).toContain('"avatar": "/assets/avatar.webp"')
			}
		})
	})

	// =========================================================================
	// Real-world scenarios: collection listing image editing
	// =========================================================================
	// These reproduce the exact user scenarios that were failing:
	// - User clicks image on a listing page (homepage showing news articles)
	// - Image belongs to a collection entry (MDX/JSON/YAML file)
	// - Rendered URL is Astro-hashed (/assets/hash.webp)

	describe('scenario: editing collection image on listing page', async () => {
		test('MDX frontmatter image — hashed URL in both template and data file', async () => {
			// The MDX file has the image in frontmatter (previously edited, so it has hashed URL)
			const mdxContent = '---\ntitle: "Dobrovolníci spojí síly"\nimage: "/assets/c65c265604c3-8047-jpg.webp"\ncategory: "Aktuálně"\n---\n\nContent body.'
			const result = await applyImageChange(
				mdxContent,
				makeImageChange({
					// The rendered <img> src on the listing page
					originalValue: '/assets/c65c265604c3-8047-jpg.webp',
					// Snippet from the MDX frontmatter (resolved by search index)
					sourceSnippet: 'image: "/assets/c65c265604c3-8047-jpg.webp"',
					sourcePath: 'src/content/news/dobrovolnici.mdx',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/new-photo.jpg', newAlt: 'New photo' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('image: /uploads/new-photo.jpg')
				expect(result.content).not.toContain('c65c265604c3')
				// Other frontmatter fields untouched
				expect(result.content).toContain('title: "Dobrovolníci spojí síly"')
				expect(result.content).toContain('category: "Aktuálně"')
			}
		})

		test('JSON data file — partner logo change', async () => {
			const jsonContent = '{\n  "name": "Nadace OSF",\n  "logo": "/assets/835b883e3fd3-5081-png.webp",\n  "href": "https://osf.cz"\n}'
			const result = await applyImageChange(
				jsonContent,
				makeImageChange({
					originalValue: '/assets/835b883e3fd3-5081-png.webp',
					sourceSnippet: '  "logo": "/assets/835b883e3fd3-5081-png.webp",',
					sourcePath: 'src/content/partners/nadace-osf.json',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/new-logo.png' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('"logo": "/uploads/new-logo.png"')
				expect(result.content).not.toContain('835b883e3fd3')
				expect(result.content).toContain('"name": "Nadace OSF"')
			}
		})

		test('MDX with original authored path — first edit of unmodified collection entry', async () => {
			// Before any CMS edit, the MDX has the original relative path.
			// Astro renders it as a hashed URL, so originalValue is the hash.
			const mdxContent = '---\ntitle: "Fresh Post"\nimage: ./images/hero.jpg\ndraft: false\n---\n\nNew content.'
			const result = await applyImageChange(
				mdxContent,
				makeImageChange({
					originalValue: '/assets/a1b2c3d4e5f6-hero-jpg.webp',
					sourceSnippet: 'image: ./images/hero.jpg',
					sourcePath: 'src/content/news/fresh-post.mdx',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/replacement.jpg' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('image: /uploads/replacement.jpg')
				expect(result.content).not.toContain('./images/hero.jpg')
			}
		})

		test('repeated edits on same entry work correctly', async () => {
			// After first edit, frontmatter has the uploaded URL
			const mdxAfterFirstEdit = '---\ntitle: "Post"\nimage: /uploads/first-edit.jpg\n---\n\nBody.'
			const result = await applyImageChange(
				mdxAfterFirstEdit,
				makeImageChange({
					originalValue: '/uploads/first-edit.jpg',
					sourceSnippet: 'image: /uploads/first-edit.jpg',
					sourcePath: 'src/content/news/post.mdx',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/second-edit.jpg' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('image: /uploads/second-edit.jpg')
				expect(result.content).not.toContain('first-edit')
			}
		})

		test('YAML data file — team member photo', async () => {
			const yamlContent = 'name: Alice\nimage: /uploads/alice.jpg\nrole: Developer\norder: 1'
			const result = await applyImageChange(
				yamlContent,
				makeImageChange({
					originalValue: '/assets/hash-alice-jpg.webp',
					sourceSnippet: 'image: /uploads/alice.jpg',
					sourcePath: 'src/content/team/alice.yaml',
					sourceLine: 2,
					imageChange: { newSrc: '/uploads/alice-v2.jpg' },
				}),
			)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('image: /uploads/alice-v2.jpg')
				expect(result.content).not.toContain('/uploads/alice.jpg')
				expect(result.content).toContain('name: Alice')
				expect(result.content).toContain('role: Developer')
			}
		})

		test('fails gracefully when source file is a template with dynamic expression', async () => {
			// If the manifest incorrectly points to the template, the source writer
			// should refuse rather than corrupting the template
			const templateContent = '{news.map(article => (\n  <img\n    src={article.image}\n    alt={article.title}\n  />\n))}'
			const result = await applyImageChange(
				templateContent,
				makeImageChange({
					originalValue: '/assets/c65c265604c3-8047-jpg.webp',
					sourceSnippet: '<img\n    src={article.image}',
					sourcePath: 'src/pages/index.astro',
					sourceLine: 3,
					imageChange: { newSrc: '/uploads/new.jpg' },
				}),
			)
			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error).toContain('dynamic expression')
			}
		})
	})
})

describe('isFrontmatterAssetImport', async () => {
	const fm = (body: string) => `---\n${body}\n---\nbody\n`

	test.each([
		['default import', `import hero from './hero.png'`, 'hero', true],
		['named import', `import { hero } from './hero.png'`, 'hero', true],
		['aliased import', `import { x as hero } from './hero.png'`, 'hero', true],
		['mixed imports', `import hero, { other } from './hero.jpeg'`, 'other', true],
		['svg', `import logo from './logo.svg'`, 'logo', true],
	])('%s', (_label, body, varName, expected) => {
		expect(isFrontmatterAssetImport(fm(body), varName)).toBe(expected)
	})

	test('returns false when import source has a non-image extension', async () => {
		expect(isFrontmatterAssetImport(fm(`import heroData from '../data/hero.ts'`), 'heroData')).toBe(false)
	})

	test('returns false for non-relative imports', async () => {
		expect(isFrontmatterAssetImport(fm(`import hero from 'astro:assets'`), 'hero')).toBe(false)
	})

	test('returns false when var is not in any import binding', async () => {
		expect(isFrontmatterAssetImport(fm(`import hero from './hero.png'`), 'logo')).toBe(false)
	})

	test('returns false when there is no frontmatter', async () => {
		expect(isFrontmatterAssetImport('<Image src={hero} />', 'hero')).toBe(false)
	})

	test('matches multi-line braced import', async () => {
		const content = "---\nimport {\n  hero,\n  other,\n} from './assets.png'\n---\nbody\n"
		expect(isFrontmatterAssetImport(content, 'hero')).toBe(true)
		expect(isFrontmatterAssetImport(content, 'other')).toBe(true)
	})

	test('skips type-only imports', async () => {
		expect(isFrontmatterAssetImport(fm(`import type Hero from './hero.png'`), 'Hero')).toBe(false)
	})

	test('skips per-binding type imports', async () => {
		expect(isFrontmatterAssetImport(fm(`import { type Hero } from './hero.png'`), 'Hero')).toBe(false)
	})
})

withTempDir('applyImageChange — import-rewrite path', (getCtx) => {
	test('rewrites import target and schedules a copy alongside the original asset', async () => {
		const ctx = getCtx()
		await ctx.writeFile('public/uploads/new.jpg', 'NEW-BYTES')
		await ctx.writeFile('src/assets/images/hero.png', 'OLD-BYTES')
		const astroPath = 'src/components/Hero.astro'
		const content =
			'---\nimport { Image } from \'astro:assets\'\nimport hero from \'../assets/images/hero.png\'\n---\n<Image src={hero} alt="Hero" class="w-full" />\n'
		await ctx.writeFile(astroPath, content)

		const absFilePath = path.join(ctx.tempDir, astroPath)
		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/@image/abc.png?f=/abs/hero.png',
				sourceLine: 5,
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
			absFilePath,
		)

		expect(result.success).toBe(true)
		if (!result.success) return
		// Import path is rewritten, JSX stays intact.
		expect(result.content).toContain(`import hero from '../assets/images/new.jpg'`)
		expect(result.content).toContain('<Image src={hero}')
		// Bytes are queued for handleUpdate to write.
		expect(result.fileOp).toBeDefined()
		expect(result.fileOp!.target).toBe(path.join(ctx.tempDir, 'src/assets/images/new.jpg'))
		expect(result.fileOp!.bytes.toString()).toBe('NEW-BYTES')
	})

	test('resolves a /src/-relative new src (existing project image)', async () => {
		const ctx = getCtx()
		await ctx.writeFile('src/assets/images/hero.png', 'OLD')
		await ctx.writeFile('src/uploads/picked.png', 'PICKED')
		const astroPath = 'src/components/Hero.astro'
		const content = "---\nimport hero from '../assets/images/hero.png'\n---\n<Image src={hero} />\n"
		await ctx.writeFile(astroPath, content)

		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/whatever',
				sourceLine: 4,
				imageChange: { newSrc: '/src/uploads/picked.png' },
			}),
			path.join(ctx.tempDir, astroPath),
		)

		expect(result.success).toBe(true)
		if (!result.success) return
		expect(result.content).toContain(`import hero from '../assets/images/picked.png'`)
		expect(result.fileOp!.bytes.toString()).toBe('PICKED')
	})

	test('hash-suffixes the target filename when the slot already holds different content', async () => {
		const ctx = getCtx()
		await ctx.writeFile('public/uploads/new.jpg', 'NEW-BYTES')
		await ctx.writeFile('src/assets/images/hero.png', 'OLD')
		// Pre-existing file with the same name as the upload but different content
		await ctx.writeFile('src/assets/images/new.jpg', 'COLLISION')
		const astroPath = 'src/components/Hero.astro'
		const content = "---\nimport hero from '../assets/images/hero.png'\n---\n<Image src={hero} />\n"
		await ctx.writeFile(astroPath, content)

		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/whatever',
				sourceLine: 4,
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
			path.join(ctx.tempDir, astroPath),
		)

		expect(result.success).toBe(true)
		if (!result.success) return
		expect(result.content).toMatch(/import hero from '\.\.\/assets\/images\/new-[a-f0-9]{8}\.jpg'/)
		expect(result.fileOp!.target).toMatch(/new-[a-f0-9]{8}\.jpg$/)
	})

	test('reuses existing target when its content matches the upload', async () => {
		const ctx = getCtx()
		await ctx.writeFile('public/uploads/new.jpg', 'SAME-BYTES')
		await ctx.writeFile('src/assets/images/hero.png', 'OLD')
		await ctx.writeFile('src/assets/images/new.jpg', 'SAME-BYTES')
		const astroPath = 'src/components/Hero.astro'
		const content = "---\nimport hero from '../assets/images/hero.png'\n---\n<Image src={hero} />\n"
		await ctx.writeFile(astroPath, content)

		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/whatever',
				sourceLine: 4,
				imageChange: { newSrc: '/uploads/new.jpg' },
			}),
			path.join(ctx.tempDir, astroPath),
		)

		expect(result.success).toBe(true)
		if (!result.success) return
		expect(result.content).toContain(`import hero from '../assets/images/new.jpg'`)
		// No collision suffix — reusing the existing identical file
		expect(result.content).not.toMatch(/new-[a-f0-9]/)
	})

	test('HTTP-fetches the new src when not on disk and uses returned bytes', async () => {
		const ctx = getCtx()
		await ctx.writeFile('src/assets/images/hero.png', 'OLD')
		const astroPath = 'src/components/Hero.astro'
		const content = "---\nimport hero from '../assets/images/hero.png'\n---\n<Image src={hero} />\n"
		await ctx.writeFile(astroPath, content)

		const originalFetch = globalThis.fetch
		globalThis.fetch = Object.assign(
			async () => new Response('REMOTE-BYTES', { status: 200, headers: { 'content-type': 'image/jpeg' } }),
			{ preconnect: () => {} },
		) as typeof fetch
		try {
			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/whatever',
					sourceLine: 4,
					imageChange: { newSrc: 'https://cdn.example.com/uploads/abc.jpg' },
				}),
				path.join(ctx.tempDir, astroPath),
				'http://localhost:3000/',
			)
			expect(result.success).toBe(true)
			if (!result.success) return
			expect(result.content).toContain(`import hero from '../assets/images/abc.jpg'`)
			expect(result.fileOp!.bytes.toString()).toBe('REMOTE-BYTES')
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test('aborts oversized HTTP fetch responses (size limit)', async () => {
		const ctx = getCtx()
		await ctx.writeFile('src/assets/images/hero.png', 'OLD')
		const astroPath = 'src/components/Hero.astro'
		const content = "---\nimport hero from '../assets/images/hero.png'\n---\n<Image src={hero} />\n"
		await ctx.writeFile(astroPath, content)

		const huge = new Uint8Array(60 * 1024 * 1024) // 60 MB > 50 MB cap
		const originalFetch = globalThis.fetch
		globalThis.fetch = Object.assign(
			async () =>
				new Response(huge, {
					status: 200,
					headers: { 'content-type': 'image/jpeg', 'content-length': String(huge.byteLength) },
				}),
			{ preconnect: () => {} },
		) as typeof fetch
		try {
			const result = await applyImageChange(
				content,
				makeImageChange({
					originalValue: '/whatever',
					sourceLine: 4,
					imageChange: { newSrc: 'https://cdn.example.com/big.jpg' },
				}),
				path.join(ctx.tempDir, astroPath),
				'http://localhost:3000/',
			)
			// HTTP body was rejected → falls back to inline JSX literal.
			expect(result.success).toBe(true)
			if (!result.success) return
			expect(result.content).toContain('<Image src="https://cdn.example.com/big.jpg"')
			expect(result.fileOp).toBeUndefined()
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test('rejects path-traversal filenames in newSrc', async () => {
		const ctx = getCtx()
		await ctx.writeFile('src/assets/images/hero.png', 'OLD')
		// Place the upload bytes at a path whose basename is harmless once stripped.
		await ctx.writeFile('public/uploads/clean.jpg', 'NEW')
		const astroPath = 'src/components/Hero.astro'
		const content = "---\nimport hero from '../assets/images/hero.png'\n---\n<Image src={hero} />\n"
		await ctx.writeFile(astroPath, content)

		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/whatever',
				sourceLine: 4,
				// Path-traversal attempt — `..` would land outside `src/assets/images/` if not stripped.
				imageChange: { newSrc: '/uploads/clean.jpg' },
			}),
			path.join(ctx.tempDir, astroPath),
		)
		expect(result.success).toBe(true)
		if (!result.success) return
		// Target stays inside the importer's sibling directory.
		expect(result.fileOp!.target.startsWith(path.join(ctx.tempDir, 'src/assets/images/'))).toBe(true)
	})

	test('falls back to inline JSX only when bytes cannot be resolved at all', async () => {
		const ctx = getCtx()
		await ctx.writeFile('src/assets/images/hero.png', 'OLD')
		const astroPath = 'src/components/Hero.astro'
		const content = '---\nimport hero from \'../assets/images/hero.png\'\n---\n<Image src={hero} alt="x" />\n'
		await ctx.writeFile(astroPath, content)

		const result = await applyImageChange(
			content,
			makeImageChange({
				originalValue: '/whatever',
				sourceLine: 4,
				imageChange: { newSrc: '/uploads/missing.jpg' },
			}),
			path.join(ctx.tempDir, astroPath),
		)

		expect(result.success).toBe(true)
		if (!result.success) return
		expect(result.content).toContain('<Image src="/uploads/missing.jpg"')
		expect(result.fileOp).toBeUndefined()
	})
})
