import { expect, test } from 'bun:test'
import { ensureMdxImports } from '../../src/handlers/markdown-ops'
import type { ComponentDefinition } from '../../src/types'
import { withTempDir } from '../utils'

function makeDef(name: string, file: string): ComponentDefinition {
	return { name, file, props: [], slots: [], instances: [] } as any
}

withTempDir('ensureMdxImports', (getCtx) => {
	test('no components used — returns content unchanged', () => {
		const content = '# Hello\n\nSome text.'
		const defs = { Hero: makeDef('Hero', 'src/components/Hero.astro') }

		const result = ensureMdxImports(content, 'src/content/blog/post.mdx', defs)

		expect(result).toBe(content)
	})

	test('adds missing import for single component', () => {
		const content = '# Post\n\n<Hero title="Welcome" />'
		const defs = { Hero: makeDef('Hero', 'src/components/Hero.astro') }

		const result = ensureMdxImports(content, 'src/content/blog/post.mdx', defs)

		expect(result).toStartWith("import Hero from '../../components/Hero.astro'")
		expect(result).toContain('<Hero title="Welcome" />')
	})

	test('skips already-imported component (default import)', () => {
		const content = "import Hero from '../components/Hero.astro'\n\n<Hero />"
		const defs = { Hero: makeDef('Hero', 'src/components/Hero.astro') }

		const result = ensureMdxImports(content, 'src/content/blog/post.mdx', defs)

		expect(result).toBe(content)
	})

	test('skips already-imported component (named import with alias)', () => {
		const content = "import { Card as Hero } from '../lib'\n\n<Hero />"
		const defs = { Hero: makeDef('Hero', 'src/components/Hero.astro') }

		const result = ensureMdxImports(content, 'src/content/blog/post.mdx', defs)

		expect(result).toBe(content)
	})

	test('skips component not in definitions', () => {
		const content = '<UnknownComponent />'
		const defs: Record<string, ComponentDefinition> = {}

		const result = ensureMdxImports(content, 'src/content/blog/post.mdx', defs)

		expect(result).toBe(content)
	})

	test('multiple missing components', () => {
		const content = '<Hero />\n<Card />'
		const defs = {
			Hero: makeDef('Hero', 'src/components/Hero.astro'),
			Card: makeDef('Card', 'src/components/Card.astro'),
		}

		const result = ensureMdxImports(content, 'src/content/blog/post.mdx', defs)

		expect(result).toContain("import Hero from '../../components/Hero.astro'")
		expect(result).toContain("import Card from '../../components/Card.astro'")
		expect(result).toContain('<Hero />')
		expect(result).toContain('<Card />')
	})

	test('inserts after existing imports', () => {
		const content = "import Something from './something'\n\n<Hero />"
		const defs = { Hero: makeDef('Hero', 'src/components/Hero.astro') }

		const result = ensureMdxImports(content, 'src/content/blog/post.mdx', defs)

		const lines = result.split('\n')
		const somethingIdx = lines.findIndex((l) => l.includes('import Something from'))
		const heroIdx = lines.findIndex((l) => l.includes('import Hero from'))

		expect(somethingIdx).toBeGreaterThanOrEqual(0)
		expect(heroIdx).toBeGreaterThan(somethingIdx)
	})

	test('skips lowercase HTML tags', () => {
		const content = '<div><img src="test.jpg" /><span>hi</span></div>'
		const defs = { Hero: makeDef('Hero', 'src/components/Hero.astro') }

		const result = ensureMdxImports(content, 'src/content/blog/post.mdx', defs)

		expect(result).toBe(content)
	})

	test('handles namespace import (already imported)', () => {
		const content = "import * as Icons from './icons'\n\n<Icons />"
		const defs = { Icons: makeDef('Icons', 'src/components/Icons.astro') }

		const result = ensureMdxImports(content, 'src/content/blog/post.mdx', defs)

		expect(result).toBe(content)
	})
})
