import { expect, test } from 'bun:test'
import { cmsDescribe, expectComponentCount, html } from '../utils'

cmsDescribe('Multiple Component Instances', { markComponents: true, generateManifest: true }, (ctx) => {
	test('detects two instances of the same component', async () => {
		const input = `
			<div>
				${html.component('CTASection', '<h2>CTA 1</h2><a>Click</a>')}
				${html.component('CTASection', '<h2>CTA 2</h2><a>Click</a>')}
			</div>
		`
		const result = await ctx.process(input)

		expectComponentCount(result, 2)
		const components = Object.values(result.components)
		expect(components[0]?.componentName).toBe('CTASection')
		expect(components[1]?.componentName).toBe('CTASection')
		// Each should have its own unique ID
		expect(components[0]?.id).not.toBe(components[1]?.id)
	})

	test('detects duplicate components mixed with unique ones', async () => {
		const input = `
			<div>
				${html.component('HeroSection', '<h1>Hero</h1>')}
				${html.component('CTASection', '<h2>CTA 1</h2>')}
				${html.component('ServicesSection', '<h2>Services</h2><p>Description</p>')}
				${html.component('CTASection', '<h2>CTA 2</h2>')}
			</div>
		`
		const result = await ctx.process(input)

		expectComponentCount(result, 4)
		const names = Object.values(result.components).map(c => c.componentName)
		expect(names.filter(n => n === 'CTASection')).toHaveLength(2)
		expect(names.filter(n => n === 'HeroSection')).toHaveLength(1)
		expect(names.filter(n => n === 'ServicesSection')).toHaveLength(1)
	})

	test('assigns correct entries to each instance', async () => {
		const input = `
			<div>
				${html.component('Card', '<h2>Card A</h2><p>Description A</p>')}
				${html.component('Card', '<h2>Card B</h2><p>Description B</p>')}
			</div>
		`
		const result = await ctx.process(input)

		expectComponentCount(result, 2)

		const components = Object.values(result.components)
		const comp1 = components[0]!
		const comp2 = components[1]!

		// Each component's entries should reference their own component ID
		const comp1Entries = Object.values(result.entries).filter(e => e.parentComponentId === comp1.id)
		const comp2Entries = Object.values(result.entries).filter(e => e.parentComponentId === comp2.id)

		expect(comp1Entries.length).toBeGreaterThan(0)
		expect(comp2Entries.length).toBeGreaterThan(0)
		// No entry should belong to both
		expect(comp1Entries.every(e => e.parentComponentId !== comp2.id)).toBe(true)
	})

	test('handles three instances of the same component', async () => {
		const input = `
			<div>
				${html.component('Banner', '<h3>Banner 1</h3>')}
				${html.component('Banner', '<h3>Banner 2</h3>')}
				${html.component('Banner', '<h3>Banner 3</h3>')}
			</div>
		`
		const result = await ctx.process(input)

		expectComponentCount(result, 3)
		const names = Object.values(result.components).map(c => c.componentName)
		expect(names.every(n => n === 'Banner')).toBe(true)
	})

	test('each instance gets its own data-cms-component-id', async () => {
		const input = `
			<div>
				${html.component('Section', '<h2>Section A</h2>')}
				${html.component('Section', '<h2>Section B</h2>')}
			</div>
		`
		const result = await ctx.process(input)

		const componentIds = result.html.match(/data-cms-component-id="[^"]+"/g)
		expect(componentIds).toHaveLength(2)
		expect(componentIds![0]).not.toBe(componentIds![1])
	})
})
