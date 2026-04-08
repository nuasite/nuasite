import { describe, expect, test } from 'bun:test'
import { normalizePagePath, pageToSlug } from '../src/storage/slug'

describe('pageToSlug', () => {
	test('root page becomes index', () => {
		expect(pageToSlug('/')).toBe('index')
		expect(pageToSlug('')).toBe('index')
		expect(pageToSlug('  ')).toBe('index')
	})

	test('simple page path', () => {
		expect(pageToSlug('/about')).toBe('about')
		expect(pageToSlug('/inspekce-nemovitosti')).toBe('inspekce-nemovitosti')
	})

	test('strips leading and trailing slashes', () => {
		expect(pageToSlug('/about/')).toBe('about')
		expect(pageToSlug('about/')).toBe('about')
		expect(pageToSlug('///about///')).toBe('about')
	})

	test('nested paths use double underscores', () => {
		expect(pageToSlug('/blog/post-name')).toBe('blog__post-name')
		expect(pageToSlug('/a/b/c')).toBe('a__b__c')
	})

	test('lowercases the slug', () => {
		expect(pageToSlug('/About')).toBe('about')
		expect(pageToSlug('/Blog/PostName')).toBe('blog__postname')
	})

	test('replaces unsafe characters with dashes', () => {
		expect(pageToSlug('/hello world')).toBe('hello-world')
		expect(pageToSlug('/café')).toBe('caf')
	})

	test('strips leading/trailing dashes from segments', () => {
		expect(pageToSlug('/ about ')).toBe('about')
	})
})

describe('normalizePagePath', () => {
	test('empty string becomes /', () => {
		expect(normalizePagePath('')).toBe('/')
	})

	test('adds leading slash if missing', () => {
		expect(normalizePagePath('about')).toBe('/about')
		expect(normalizePagePath('blog/post')).toBe('/blog/post')
	})

	test('preserves leading slash', () => {
		expect(normalizePagePath('/about')).toBe('/about')
	})

	test('strips trailing slash except for root', () => {
		expect(normalizePagePath('/about/')).toBe('/about')
		expect(normalizePagePath('/')).toBe('/')
	})

	test('trims whitespace', () => {
		expect(normalizePagePath('  /about  ')).toBe('/about')
	})
})
