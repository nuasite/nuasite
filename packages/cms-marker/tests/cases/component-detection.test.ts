import { expect, test } from 'bun:test'
import { cmsDescribe, expectComponentCount, expectNoComponents, html } from '../utils'

cmsDescribe('Component Detection', { markComponents: true, generateManifest: true }, (ctx) => {
	test('marks components from src/components with relative paths', async () => {
		const result = await ctx.process(html.component('Welcome', '<h1>Welcome</h1>'))

		expect(result.html).toContain('data-cms-component-id')
		expectComponentCount(result, 1)
		expect(Object.values(result.components)[0]?.componentName).toBe('Welcome')
	})

	test('marks components from custom component directory', async () => {
		const input = '<div data-astro-source-file="src/ui/Button.astro"><button>Click</button></div>'
		const result = await ctx.process(input, { componentDirs: ['src/ui'] })

		expect(result.html).toContain('data-cms-component-id')
		expectComponentCount(result, 1)
	})

	test('does NOT mark components from src/pages (excluded)', async () => {
		const input = '<div data-astro-source-file="src/pages/index.astro"><h1>Home</h1></div>'
		const result = await ctx.process(input)

		expect(result.html).not.toContain('data-cms-component-id')
		expectNoComponents(result)
	})

	test('does NOT mark components from src/layouts (excluded)', async () => {
		const input = '<div data-astro-source-file="src/layouts/Layout.astro"><main></main></div>'
		const result = await ctx.process(input)

		expect(result.html).not.toContain('data-cms-component-id')
		expectNoComponents(result)
	})

	test('does NOT mark components from src/layout (excluded - singular)', async () => {
		const input = '<div data-astro-source-file="src/layout/Base.astro"><main></main></div>'
		const result = await ctx.process(input)

		expect(result.html).not.toContain('data-cms-component-id')
		expectNoComponents(result)
	})

	test('marks components with absolute paths', async () => {
		const input = '<div data-astro-source-file="/absolute/path/src/components/Card.astro"><div>Card</div></div>'
		const result = await ctx.process(input)

		expect(result.html).toContain('data-cms-component-id')
		expectComponentCount(result, 1)
	})

	test('respects custom excludeComponentDirs', async () => {
		const input = '<div data-astro-source-file="src/vendor/External.astro"><div>Vendor</div></div>'
		const result = await ctx.process(input, { excludeComponentDirs: ['src/vendor'] })

		expect(result.html).not.toContain('data-cms-component-id')
		expectNoComponents(result)
	})

	test('handles paths with nested directories', async () => {
		const input = '<div data-astro-source-file="src/components/ui/Button.astro"><button>Click</button></div>'
		const result = await ctx.process(input)

		expect(result.html).toContain('data-cms-component-id')
		expectComponentCount(result, 1)
		expect(Object.values(result.components)[0]?.componentName).toBe('Button')
	})

	test('marks components from any directory when componentDirs is empty and not excluded', async () => {
		const input = '<div data-astro-source-file="src/custom/MyComponent.astro"><div>Custom</div></div>'
		const result = await ctx.process(input, { componentDirs: [] })

		expect(result.html).toContain('data-cms-component-id')
		expectComponentCount(result, 1)
	})

	test('only marks outermost component when nested', async () => {
		const input = `
			<div data-astro-source-file="src/components/Card.astro">
				<div data-astro-source-file="src/components/Card.astro">
					<h1>Title</h1>
				</div>
			</div>
		`
		const result = await ctx.process(input)

		const componentIds = result.html.match(/data-cms-component-id/g)
		expect(componentIds?.length).toBe(1)
	})

	test('marks multiple different components', async () => {
		const input = `
			${html.component('Header', '<header>Header</header>')}
			${html.component('Footer', '<footer>Footer</footer>')}
		`
		const result = await ctx.process(input)

		expectComponentCount(result, 2)
		const componentNames = Object.values(result.components).map((c) => c.componentName)
		expect(componentNames).toContain('Header')
		expect(componentNames).toContain('Footer')
	})

	test('tracks parentComponentId for text elements inside components', async () => {
		const input = html.component('Card', '<h1>Card Title</h1><p>Card description</p>')
		const result = await ctx.process(input)

		const componentId = Object.keys(result.components)[0]
		expect(componentId).toBeDefined()

		const entries = Object.values(result.entries)
		expect(entries.length).toBeGreaterThan(0)

		for (const entry of entries) {
			expect(entry.parentComponentId).toBe(componentId)
		}
	})

	test('does not set parentComponentId for text elements outside components', async () => {
		const input = '<div><h1>Standalone Title</h1></div>'
		const result = await ctx.process(input)

		const entries = Object.values(result.entries)
		expect(entries.length).toBeGreaterThan(0)

		for (const entry of entries) {
			expect(entry.parentComponentId).toBeUndefined()
		}
	})
})

cmsDescribe('Component Detection Snapshots', { markComponents: true, generateManifest: true }, (ctx) => {
	test('nested component with text elements', async () => {
		const input = `
			<div data-astro-source-file="src/components/Card.astro">
				<h1>Card Title</h1>
				<p>Card description with <strong>bold</strong> text</p>
			</div>
		`
		const result = await ctx.process(input)

		expect(result.html).toMatchSnapshot('html')
		expect(result.entries).toMatchSnapshot('entries')
		expect(result.components).toMatchSnapshot('components')
	})

	test('multiple components with various content', async () => {
		const input = `
			<div data-astro-source-file="src/components/Header.astro">
				<h1>Site Header</h1>
				<nav>Navigation</nav>
			</div>
			<div data-astro-source-file="src/components/Hero.astro">
				<h2>Welcome</h2>
				<p>Hero description</p>
			</div>
		`
		const result = await ctx.process(input)

		expect(result.html).toMatchSnapshot('html')
		expect(result.entries).toMatchSnapshot('entries')
		expect(result.components).toMatchSnapshot('components')
	})
})
