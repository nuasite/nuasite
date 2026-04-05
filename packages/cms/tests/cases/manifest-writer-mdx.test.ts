import { describe, expect, test } from 'bun:test'
import { ManifestWriter } from '../../src/manifest-writer'

describe('ManifestWriter MDX components', () => {
	test('should store names in global manifest', () => {
		const writer = new ManifestWriter('cms-manifest.json')

		writer.setMdxComponents(['Hero', 'Card'])

		const manifest = writer.getGlobalManifest()
		expect(manifest.mdxComponents).toEqual(['Hero', 'Card'])
	})

	test('should be undefined by default', () => {
		const writer = new ManifestWriter('cms-manifest.json')

		const manifest = writer.getGlobalManifest()
		expect(manifest.mdxComponents).toBeUndefined()
	})

	test('should persist after reset', () => {
		const writer = new ManifestWriter('cms-manifest.json')

		writer.setMdxComponents(['Hero', 'Banner'])
		writer.reset()

		const manifest = writer.getGlobalManifest()
		expect(manifest.mdxComponents).toEqual(['Hero', 'Banner'])
	})
})
