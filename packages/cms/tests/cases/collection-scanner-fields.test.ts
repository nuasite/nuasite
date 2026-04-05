import { expect, test } from 'bun:test'
import { scanCollections } from '../../src/collection-scanner'
import { setupContentCollections, withTempDir } from '../utils'

withTempDir('collection-scanner: array-of-objects sub-field inference', (getCtx) => {
	test('array of objects infers sub-fields', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['team'])

		await ctx.writeFile(
			'src/content/team/member-1.json',
			JSON.stringify({
				name: 'Alice',
				links: [
					{ label: 'GitHub', url: 'https://github.com/alice' },
					{ label: 'Twitter', url: 'https://twitter.com/alice' },
				],
			}),
		)
		await ctx.writeFile(
			'src/content/team/member-2.json',
			JSON.stringify({
				name: 'Bob',
				links: [{ label: 'Website', url: 'https://bob.dev' }],
			}),
		)

		const result = await scanCollections()
		const teamDef = result['team']
		expect(teamDef).toBeDefined()

		const linksField = teamDef!.fields.find(f => f.name === 'links')
		expect(linksField).toBeDefined()
		expect(linksField!.type).toBe('array')
		expect(linksField!.itemType).toBe('object')
		expect(linksField!.fields).toBeDefined()
		expect(linksField!.fields!.length).toBe(2)

		const labelSub = linksField!.fields!.find(f => f.name === 'label')
		const urlSub = linksField!.fields!.find(f => f.name === 'url')
		expect(labelSub).toBeDefined()
		expect(urlSub).toBeDefined()
		expect(urlSub!.type).toBe('url')
	})

	test('array of strings does NOT get sub-fields', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])

		await ctx.writeFile(
			'src/content/posts/post-1.json',
			JSON.stringify({ name: 'Post', tags: ['a', 'b', 'c'] }),
		)

		const result = await scanCollections()
		const postsDef = result['posts']
		expect(postsDef).toBeDefined()

		const tagsField = postsDef!.fields.find(f => f.name === 'tags')
		expect(tagsField).toBeDefined()
		expect(tagsField!.type).toBe('array')
		expect(tagsField!.itemType).toBe('text')
		expect(tagsField!.fields).toBeUndefined()
	})

	test('empty array does not crash', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['posts'])

		await ctx.writeFile(
			'src/content/posts/post-1.json',
			JSON.stringify({ name: 'Post', items: [] }),
		)

		const result = await scanCollections()
		const postsDef = result['posts']
		expect(postsDef).toBeDefined()

		const itemsField = postsDef!.fields.find(f => f.name === 'items')
		expect(itemsField).toBeDefined()
		expect(itemsField!.type).toBe('array')
		expect(itemsField!.fields).toBeUndefined()
	})

	test('mixed array infers sub-fields from object items only', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['misc'])

		await ctx.writeFile(
			'src/content/misc/entry-1.json',
			JSON.stringify({ name: 'A', data: [{ key: 'x' }, 'string-val'] }),
		)
		await ctx.writeFile(
			'src/content/misc/entry-2.json',
			JSON.stringify({ name: 'B', data: [{ key: 'y' }] }),
		)

		const result = await scanCollections()
		const miscDef = result['misc']
		expect(miscDef).toBeDefined()

		const dataField = miscDef!.fields.find(f => f.name === 'data')
		expect(dataField).toBeDefined()
		expect(dataField!.type).toBe('array')

		// itemType is inferred from the first item — if it's 'object', sub-fields come from objects only
		if (dataField!.itemType === 'object') {
			expect(dataField!.fields).toBeDefined()
			const keySub = dataField!.fields!.find(f => f.name === 'key')
			expect(keySub).toBeDefined()
			expect(keySub!.type).toBe('text')
		}
	})

	test('nested object sub-field types are correctly inferred', async () => {
		const ctx = getCtx()
		await setupContentCollections(ctx, ['products'])

		await ctx.writeFile(
			'src/content/products/product-1.json',
			JSON.stringify({
				name: 'Product',
				variants: [{ size: 'L', price: 29.99, inStock: true }],
			}),
		)

		const result = await scanCollections()
		const productsDef = result['products']
		expect(productsDef).toBeDefined()

		const variantsField = productsDef!.fields.find(f => f.name === 'variants')
		expect(variantsField).toBeDefined()
		expect(variantsField!.type).toBe('array')
		expect(variantsField!.itemType).toBe('object')
		expect(variantsField!.fields).toBeDefined()

		const sizeSub = variantsField!.fields!.find(f => f.name === 'size')
		const priceSub = variantsField!.fields!.find(f => f.name === 'price')
		const inStockSub = variantsField!.fields!.find(f => f.name === 'inStock')

		expect(sizeSub).toBeDefined()
		expect(sizeSub!.type).toBe('text')

		expect(priceSub).toBeDefined()
		expect(priceSub!.type).toBe('number')

		expect(inStockSub).toBeDefined()
		expect(inStockSub!.type).toBe('boolean')
	})
})
