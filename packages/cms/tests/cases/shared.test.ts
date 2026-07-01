import { describe, expect, test } from 'bun:test'
import { resolveCreateRedirectUrl } from '../../src/shared'

describe('resolveCreateRedirectUrl', () => {
	test('reuses the shared prefix when every entry with a pathname agrees', () => {
		const entries = [
			{ pathname: '/blog/first-post' },
			{ pathname: '/blog/second-post' },
			{}, // entry without a pathname yet — ignored
		]
		expect(resolveCreateRedirectUrl(entries, 'new-post')).toBe('/blog/new-post')
	})

	test('returns undefined when sibling entries disagree on prefix (e.g. dynamic [topic]/[slug] route)', () => {
		// Regression test: before the fix, this picked whichever entry happened to
		// be first and could redirect a new entry to the wrong topic.
		const entries = [
			{ pathname: '/lide/kdo-jsme' },
			{ pathname: '/fundraising/podpora' },
		]
		expect(resolveCreateRedirectUrl(entries, 'new-slug')).toBeUndefined()
	})

	test('returns undefined when no entry has a pathname yet', () => {
		expect(resolveCreateRedirectUrl([{}, {}], 'new-slug')).toBeUndefined()
	})

	test('returns undefined for an empty collection', () => {
		expect(resolveCreateRedirectUrl([], 'new-slug')).toBeUndefined()
	})

	test('works with a single existing entry', () => {
		expect(resolveCreateRedirectUrl([{ pathname: '/news/first' }], 'second')).toBe('/news/second')
	})
})
