import { describe, expect, test } from 'bun:test'
import { manifestUrlForPage } from '../src/overlay/lib/manifest-fetch'

describe('manifestUrlForPage', () => {
	test('root page maps to /index.json', () => {
		expect(manifestUrlForPage('/')).toBe('/index.json')
		expect(manifestUrlForPage('')).toBe('/index.json')
	})

	test('simple page path', () => {
		expect(manifestUrlForPage('/about')).toBe('/about.json')
		expect(manifestUrlForPage('/inspekce-nemovitosti')).toBe('/inspekce-nemovitosti.json')
	})

	test('strips leading and trailing slashes', () => {
		expect(manifestUrlForPage('/about/')).toBe('/about.json')
	})

	test('nested paths', () => {
		expect(manifestUrlForPage('/blog/post')).toBe('/blog/post.json')
	})
})
