import { createNodeFs, entryPathname, parseRouteMap, readRouteMap, ROUTE_MAP_VERSION, serializeRouteMap } from '@nuasite/cms-core'
import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const tempDirs: string[] = []
afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

async function tempWith(routesJson?: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'route-map-'))
	tempDirs.push(dir)
	if (routesJson !== undefined) {
		await fs.mkdir(path.join(dir, '.nua', 'cms'), { recursive: true })
		await fs.writeFile(path.join(dir, '.nua', 'cms', 'routes.json'), routesJson)
	}
	return dir
}

describe('entryPathname', () => {
	test('per-item joins base and slug', () => {
		expect(entryPathname({ base: '/produkty', perItem: true }, 'zidle')).toBe('/produkty/zidle')
	})
	test('per-item at root does not double the slash', () => {
		expect(entryPathname({ base: '/', perItem: true }, 'desk')).toBe('/desk')
	})
	test('shared page ignores the slug', () => {
		expect(entryPathname({ base: '/faq', perItem: false }, 'anything')).toBe('/faq')
	})
})

describe('parseRouteMap / serializeRouteMap', () => {
	test('round-trips a collections map', () => {
		const collections = { products: { base: '/produkty', perItem: true }, faq: { base: '/faq', perItem: false } }
		expect(parseRouteMap(serializeRouteMap(collections))).toEqual(collections)
	})
	test('rejects a wrong version', () => {
		expect(parseRouteMap(JSON.stringify({ version: 999, collections: { a: { base: '/a', perItem: true } } }))).toBeNull()
	})
	test('rejects non-JSON and non-objects', () => {
		expect(parseRouteMap('not json')).toBeNull()
		expect(parseRouteMap('123')).toBeNull()
	})
	test('drops malformed entries but keeps the valid ones', () => {
		const json = JSON.stringify({
			version: ROUTE_MAP_VERSION,
			collections: { good: { base: '/g', perItem: true }, badBase: { base: 5, perItem: true }, missingPerItem: { base: '/b' }, notObject: 'nope' },
		})
		expect(parseRouteMap(json)).toEqual({ good: { base: '/g', perItem: true } })
	})
})

describe('readRouteMap', () => {
	test('returns the map when the file is present and valid', async () => {
		const dir = await tempWith(serializeRouteMap({ products: { base: '/produkty', perItem: true } }))
		const map = await readRouteMap(createNodeFs(dir))
		expect(map?.get('products')).toEqual({ base: '/produkty', perItem: true })
	})
	test('returns null when the file is absent (fall back to the scan)', async () => {
		const dir = await tempWith()
		expect(await readRouteMap(createNodeFs(dir))).toBeNull()
	})
	test('returns null when the map is empty', async () => {
		const dir = await tempWith(serializeRouteMap({}))
		expect(await readRouteMap(createNodeFs(dir))).toBeNull()
	})
})
