import { describe, expect, test } from 'bun:test'
import { processHtml } from '../../src/html-processor'

describe('Component Detection', () => {
	let counter = 0
	const getNextId = () => `cms-${counter++}`

	const getOptions = (overrides = {}) => ({
		attributeName: 'data-cms-id',
		includeTags: null,
		excludeTags: [],
		includeEmptyText: false,
		generateManifest: false,
		markComponents: true,
		...overrides,
	})

	test('should mark components from src/components with relative paths', async () => {
		counter = 0
		const html = '<div data-astro-source-file="src/components/Welcome.astro"><h1>Welcome</h1></div>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		expect(result.html).toContain('data-cms-component-id')
		expect(Object.keys(result.components)).toHaveLength(1)
		const component = Object.values(result.components)[0]
		expect(component?.componentName).toBe('Welcome')
	})

	test('should mark components from custom component directory', async () => {
		counter = 0
		const html = '<div data-astro-source-file="src/ui/Button.astro"><button>Click</button></div>'
		const result = await processHtml(
			html,
			'test.html',
			getOptions({ componentDirs: ['src/ui'] }),
			getNextId,
		)

		expect(result.html).toContain('data-cms-component-id')
		expect(Object.keys(result.components)).toHaveLength(1)
	})

	test('should NOT mark components from src/pages (excluded)', async () => {
		counter = 0
		const html = '<div data-astro-source-file="src/pages/index.astro"><h1>Home</h1></div>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		expect(result.html).not.toContain('data-cms-component-id')
		expect(Object.keys(result.components)).toHaveLength(0)
	})

	test('should NOT mark components from src/layouts (excluded)', async () => {
		counter = 0
		const html = '<div data-astro-source-file="src/layouts/Layout.astro"><main></main></div>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		expect(result.html).not.toContain('data-cms-component-id')
		expect(Object.keys(result.components)).toHaveLength(0)
	})

	test('should NOT mark components from src/layout (excluded - singular)', async () => {
		counter = 0
		const html = '<div data-astro-source-file="src/layout/Base.astro"><main></main></div>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		expect(result.html).not.toContain('data-cms-component-id')
		expect(Object.keys(result.components)).toHaveLength(0)
	})

	test('should mark components with absolute paths', async () => {
		counter = 0
		const html = '<div data-astro-source-file="/absolute/path/src/components/Card.astro"><div>Card</div></div>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		expect(result.html).toContain('data-cms-component-id')
		expect(Object.keys(result.components)).toHaveLength(1)
	})

	test('should respect custom excludeComponentDirs', async () => {
		counter = 0
		const html = '<div data-astro-source-file="src/vendor/External.astro"><div>Vendor</div></div>'
		const result = await processHtml(
			html,
			'test.html',
			getOptions({ excludeComponentDirs: ['src/vendor'] }),
			getNextId,
		)

		expect(result.html).not.toContain('data-cms-component-id')
		expect(Object.keys(result.components)).toHaveLength(0)
	})

	test('should handle paths with nested directories', async () => {
		counter = 0
		const html = '<div data-astro-source-file="src/components/ui/Button.astro"><button>Click</button></div>'
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		expect(result.html).toContain('data-cms-component-id')
		expect(Object.keys(result.components)).toHaveLength(1)
		const component = Object.values(result.components)[0]
		expect(component?.componentName).toBe('Button')
	})

	test('should mark components from any directory when componentDirs is empty and not excluded', async () => {
		counter = 0
		const html = '<div data-astro-source-file="src/custom/MyComponent.astro"><div>Custom</div></div>'
		const result = await processHtml(
			html,
			'test.html',
			getOptions({ componentDirs: [] }),
			getNextId,
		)

		expect(result.html).toContain('data-cms-component-id')
		expect(Object.keys(result.components)).toHaveLength(1)
	})

	test('should only mark outermost component when nested', async () => {
		counter = 0
		const html = `
      <div data-astro-source-file="src/components/Card.astro">
        <div data-astro-source-file="src/components/Card.astro">
          <h1>Title</h1>
        </div>
      </div>
    `
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		// Only one component ID should be assigned (the outermost)
		const componentIds = result.html.match(/data-cms-component-id/g)
		expect(componentIds?.length).toBe(1)
	})

	test('should mark multiple different components', async () => {
		counter = 0
		const html = `
      <div data-astro-source-file="src/components/Header.astro"><header>Header</header></div>
      <div data-astro-source-file="src/components/Footer.astro"><footer>Footer</footer></div>
    `
		const result = await processHtml(html, 'test.html', getOptions(), getNextId)

		expect(Object.keys(result.components)).toHaveLength(2)
		const componentNames = Object.values(result.components).map(c => c.componentName)
		expect(componentNames).toContain('Header')
		expect(componentNames).toContain('Footer')
	})

	test('should track parentComponentId for text elements inside components', async () => {
		counter = 0
		const html = `
      <div data-astro-source-file="src/components/Card.astro">
        <h1>Card Title</h1>
        <p>Card description</p>
      </div>
    `
		const result = await processHtml(
			html,
			'test.html',
			getOptions({ generateManifest: true }),
			getNextId,
		)

		// Get the component ID
		const componentId = Object.keys(result.components)[0]
		expect(componentId).toBeDefined()

		// Check that text elements have parentComponentId set
		const entries = Object.values(result.entries)
		expect(entries.length).toBeGreaterThan(0)

		// All text elements should have the component as parent
		for (const entry of entries) {
			expect(entry.parentComponentId).toBe(componentId)
		}
	})

	test('should not set parentComponentId for text elements outside components', async () => {
		counter = 0
		const html = '<div><h1>Standalone Title</h1></div>'
		const result = await processHtml(
			html,
			'test.html',
			getOptions({ generateManifest: true }),
			getNextId,
		)

		const entries = Object.values(result.entries)
		expect(entries.length).toBeGreaterThan(0)

		// No parent component should be set
		for (const entry of entries) {
			expect(entry.parentComponentId).toBeUndefined()
		}
	})
})
