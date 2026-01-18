import { describe, expect, test } from 'bun:test'
import { htmlToMarkdown } from '../../src/html-to-markdown'

describe('htmlToMarkdown', () => {
	test('extracts title from title tag', () => {
		const html = '<html><head><title>My Page</title></head><body><p>Content</p></body></html>'
		const result = htmlToMarkdown(html)
		expect(result.metadata.title).toBe('My Page')
	})

	test('extracts title from h1 if no title tag', () => {
		const html = '<html><body><h1>Main Heading</h1><p>Content</p></body></html>'
		const result = htmlToMarkdown(html)
		expect(result.metadata.title).toBe('Main Heading')
	})

	test('extracts description from meta tag', () => {
		const html = '<html><head><meta name="description" content="Page description"></head><body></body></html>'
		const result = htmlToMarkdown(html)
		expect(result.metadata.description).toBe('Page description')
	})

	test('converts headings', () => {
		const html = '<main><h1>H1</h1><h2>H2</h2><h3>H3</h3></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('# H1')
		expect(result.body).toContain('## H2')
		expect(result.body).toContain('### H3')
	})

	test('converts paragraphs', () => {
		const html = '<main><p>First paragraph</p><p>Second paragraph</p></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('First paragraph')
		expect(result.body).toContain('Second paragraph')
	})

	test('converts bold and italic', () => {
		const html = '<main><p><strong>bold</strong> and <em>italic</em></p></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('**bold**')
		expect(result.body).toContain('*italic*')
	})

	test('converts links', () => {
		const html = '<main><a href="https://example.com">Example Link</a></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('[Example Link](https://example.com)')
	})

	test('converts images', () => {
		const html = '<main><img src="/image.png" alt="My Image"></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('![My Image](/image.png)')
	})

	test('converts unordered lists', () => {
		const html = '<main><ul><li>Item 1</li><li>Item 2</li></ul></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('- Item 1')
		expect(result.body).toContain('- Item 2')
	})

	test('converts ordered lists', () => {
		const html = '<main><ol><li>First</li><li>Second</li></ol></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('1. First')
		expect(result.body).toContain('1. Second')
	})

	test('converts code blocks', () => {
		const html = '<main><pre><code class="language-js">const x = 1;</code></pre></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('```js')
		expect(result.body).toContain('const x = 1;')
		expect(result.body).toContain('```')
	})

	test('converts inline code', () => {
		const html = '<main><p>Use <code>npm install</code> to install</p></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('`npm install`')
	})

	test('converts blockquotes', () => {
		const html = '<main><blockquote>A wise quote</blockquote></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('> A wise quote')
	})

	test('excludes nav, footer, header elements', () => {
		const html = '<html><body><nav>Navigation</nav><main><p>Content</p></main><footer>Footer</footer></body></html>'
		const result = htmlToMarkdown(html)
		expect(result.body).not.toContain('Navigation')
		expect(result.body).not.toContain('Footer')
		expect(result.body).toContain('Content')
	})

	test('excludes script and style tags', () => {
		const html = '<main><script>alert(1)</script><style>.x{}</style><p>Content</p></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).not.toContain('alert')
		expect(result.body).not.toContain('.x{}')
		expect(result.body).toContain('Content')
	})

	test('extracts main content from article element', () => {
		const html = '<html><body><div>Outer</div><article><p>Article content</p></article></body></html>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('Article content')
	})

	test('handles horizontal rules', () => {
		const html = '<main><p>Before</p><hr><p>After</p></main>'
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('---')
	})

	test('handles simple tables', () => {
		const html = `
			<main>
				<table>
					<tr><th>Header 1</th><th>Header 2</th></tr>
					<tr><td>Cell 1</td><td>Cell 2</td></tr>
				</table>
			</main>
		`
		const result = htmlToMarkdown(html)
		expect(result.body).toContain('| Header 1 | Header 2 |')
		expect(result.body).toContain('| --- | --- |')
		expect(result.body).toContain('| Cell 1 | Cell 2 |')
	})
})
