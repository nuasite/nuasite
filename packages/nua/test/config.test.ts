import { satteri } from '@astrojs/markdown-satteri'
import { describe, expect, test } from 'bun:test'
import { defineConfig } from '../src/config'

describe('defineConfig', () => {
	test('renders markdown with the unified processor, which runs the CMS plugins', () => {
		expect(defineConfig().markdown?.processor?.name).toBe('unified')
	})

	test('keeps the markdown options the site sets', () => {
		const config = defineConfig({ markdown: { syntaxHighlight: false } })
		expect(config.markdown?.syntaxHighlight).toBe(false)
		expect(config.markdown?.processor?.name).toBe('unified')
	})

	test('keeps the whitespace between inline elements, as Astro 6 did', () => {
		expect(defineConfig().compressHTML).toBe(true)
		expect(defineConfig({ compressHTML: 'jsx' }).compressHTML).toBe('jsx')
	})

	test('keeps a processor the site chose', () => {
		const processor = satteri()
		expect(defineConfig({ markdown: { processor } }).markdown?.processor).toBe(processor)
	})
})
