/**
 * HTML fixture builders for CMS marker tests.
 *
 * Provides convenient helpers for creating HTML test fixtures
 * with proper structure and attributes.
 *
 * @example
 * html.heading(1, 'Hello World', 'text-xl')
 * // => '<h1 class="text-xl">Hello World</h1>'
 *
 * html.component('Card', '<h2>Title</h2>')
 * // => '<div data-astro-source-file="src/components/Card.astro"><h2>Title</h2></div>'
 */

/**
 * HTML test fixture builders
 */
export const html = {
	/**
	 * Wrap content in a tag with optional attributes.
	 *
	 * @param tagName - HTML tag name
	 * @param content - Inner HTML content
	 * @param attrs - Optional attributes as key-value pairs
	 */
	tag: (tagName: string, content: string, attrs: Record<string, string> = {}) => {
		const attrStr = Object.entries(attrs)
			.map(([k, v]) => `${k}="${v}"`)
			.join(' ')
		return `<${tagName}${attrStr ? ' ' + attrStr : ''}>${content}</${tagName}>`
	},

	/**
	 * Create a span with optional classes.
	 */
	span: (content: string, classes?: string) => classes ? `<span class="${classes}">${content}</span>` : `<span>${content}</span>`,

	/**
	 * Create a paragraph with optional classes.
	 */
	p: (content: string, classes?: string) => classes ? `<p class="${classes}">${content}</p>` : `<p>${content}</p>`,

	/**
	 * Create a heading at the specified level.
	 *
	 * @param level - Heading level (1-6)
	 * @param content - Inner HTML content
	 * @param classes - Optional CSS classes
	 */
	heading: (level: 1 | 2 | 3 | 4 | 5 | 6, content: string, classes?: string) =>
		classes ? `<h${level} class="${classes}">${content}</h${level}>` : `<h${level}>${content}</h${level}>`,

	/**
	 * Create an element with Astro source attributes (for dev mode testing).
	 *
	 * @param tagName - HTML tag name
	 * @param content - Inner HTML content
	 * @param sourcePath - Path to the source file
	 * @param line - Line and column (default: '1:0')
	 */
	withSource: (tagName: string, content: string, sourcePath: string, line = '1:0') =>
		`<${tagName} data-astro-source-file="${sourcePath}" data-astro-source-line="${line}">${content}</${tagName}>`,

	/**
	 * Wrap content in a div with optional classes.
	 */
	div: (content: string, classes?: string) => classes ? `<div class="${classes}">${content}</div>` : `<div>${content}</div>`,

	/**
	 * Create a component wrapper (div with Astro source from components dir).
	 *
	 * @param name - Component name (without extension)
	 * @param content - Inner HTML content
	 * @param dir - Component directory (default: 'src/components')
	 */
	component: (name: string, content: string, dir = 'src/components') => `<div data-astro-source-file="${dir}/${name}.astro">${content}</div>`,

	/**
	 * Create a button with optional classes.
	 */
	button: (content: string, classes?: string) => classes ? `<button class="${classes}">${content}</button>` : `<button>${content}</button>`,
}
