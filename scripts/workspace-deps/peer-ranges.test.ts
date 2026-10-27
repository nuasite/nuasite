import { describe, expect, test } from 'bun:test'
import { exactVersion, peerRange, pinnedPeers } from './peer-ranges.ts'

describe('exactVersion', () => {
	test('recognises every spelling of one version', () => {
		for (const range of ['7.4.2', '=7.4.2', '= 7.4.2', 'v7.4.2', ' 7.4.2 ', '7.4.2+build.1']) {
			expect(exactVersion(range)).toBe('7.4.2')
		}
		expect(exactVersion('7.0.0-beta.1')).toBe('7.0.0-beta.1')
	})

	test('a range is not exact', () => {
		for (const range of ['^7.4.2', '~7.4.2', '>=7.4.2', '7.x', '*', '7.4.2 || 8.0.0', '7', 'latest']) {
			expect(exactVersion(range)).toBeNull()
		}
	})
})

describe('peerRange', () => {
	test('widens a third-party catalog version to a caret range', () => {
		expect(peerRange('astro', '7.4.2', { allowPinned: false })).toBe('^7.4.2')
		expect(peerRange('astro', '=7.4.2', { allowPinned: false })).toBe('^7.4.2')
	})

	test('keeps a range, an @nuasite version, and a package that pins on purpose', () => {
		expect(peerRange('@astrojs/compiler', '^4.0.0', { allowPinned: false })).toBe('^4.0.0')
		expect(peerRange('@nuasite/cms', '0.65.0', { allowPinned: false })).toBe('0.65.0')
		expect(peerRange('@astrojs/mdx', '8.1.1', { allowPinned: true })).toBe('8.1.1')
	})
})

describe('pinnedPeers', () => {
	test('reports a hand-written exact third-party peer', () => {
		expect(pinnedPeers({ 'astro': '7.4.2', 'vite': '^8.0.0', '@nuasite/cms': '0.65.0' }, { allowPinned: false })).toEqual([
			'peerDependencies:astro is pinned to 7.4.2; publish a range',
		])
		expect(pinnedPeers({ astro: 'v7.4.2' }, { allowPinned: false })).toHaveLength(1)
	})

	test('reports nothing for a package that pins on purpose, or without peers', () => {
		expect(pinnedPeers({ astro: '7.4.2' }, { allowPinned: true })).toEqual([])
		expect(pinnedPeers(undefined, { allowPinned: false })).toEqual([])
	})
})
