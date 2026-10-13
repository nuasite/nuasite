import * as fields from '@nuasite/cms/fields'
import * as rehype from '@nuasite/cms/rehype'
import * as remark from '@nuasite/cms/remark'
import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import rehypeStringify from 'rehype-stringify'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { builtinImportsOf } from '../utils/builtin-imports'

const packageDir = path.join(import.meta.dir, '../..')
const PORTABLE_MODULE_KEY = Symbol.for('pletivo.portableModule')

describe('Node-free entries', () => {
	const entries = {
		fields: path.join(packageDir, 'src/fields.ts'),
		remark: path.join(packageDir, 'src/markdown/remark.ts'),
		rehype: path.join(packageDir, 'src/markdown/rehype.ts'),
		// Imports the package root, whose default entry imports `node:fs` at the top level.
		contentConfig: path.join(packageDir, 'tests/fixtures/portable/content-config.ts'),
		cmsCore: path.join(packageDir, '../cms-core/src/portable.ts'),
		cmsSidecar: path.join(packageDir, '../cms-sidecar/src/portable.ts'),
	}
	test.each(['fields', 'remark', 'rehype', 'contentConfig'] as const)('%s imports no Node built-in', async name => {
		expect(await builtinImportsOf(entries[name], ['workerd'])).toEqual([])
	})

	test('the editor host under workerd imports only what a Worker with nodejs_compat provides', async () => {
		const entry = path.join(packageDir, 'src/editor-host.ts')
		expect(await builtinImportsOf(entry, ['workerd'])).toEqual(['node:async_hooks', 'node:crypto', 'node:path'])
	})

	test.each(['cmsCore', 'cmsSidecar'] as const)('%s imports no Node filesystem', async name => {
		// Both are available in a Worker with `nodejs_compat`; `node:fs` is not.
		expect(await builtinImportsOf(entries[name], ['workerd'])).toEqual(['node:crypto', 'node:path'])
	})

	test('the fields entry provides the schema helpers the package root provides', async () => {
		const root = await import('@nuasite/cms')
		expect(fields.n).toBe(root.n)
		expect(fields.defineCmsCollection).toBe(root.defineCmsCollection)
		expect(fields.FIELD_TYPES).toBe(root.FIELD_TYPES)
		expect(fields.n.object({ title: fields.n.text() }).safeParse({ title: 'Hello' }).success).toBe(true)
	})

	test('package.json declares the portable API marker', async () => {
		const manifest: unknown = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf-8'))
		expect(manifest).toMatchObject({ nuasite: { portableApi: 1 } })
	})
})

describe('portable markdown plugins', () => {
	const tagged = [
		...remark.cmsRemarkPlugins.map(plugin => ({ plugin, from: remark })),
		{ plugin: rehype.rehypeCmsMarker, from: rehype },
	]

	test.each(tagged)('$plugin.name names a module export that is the same function', async ({ plugin }) => {
		const reference: unknown = Reflect.get(plugin, PORTABLE_MODULE_KEY)
		expect(reference).toEqual({ module: expect.stringMatching(/^@nuasite\/cms\//), export: expect.any(String) })
		if (typeof reference !== 'object' || reference === null) throw new Error('no reference')
		const loaded: unknown = await import(String(Reflect.get(reference, 'module')))
		if (typeof loaded !== 'object' || loaded === null) throw new Error('module did not load')
		expect(Reflect.get(loaded, String(Reflect.get(reference, 'export')))).toBe(plugin)
	})

	test('the reference is not enumerable, so it never ends up in serialized options', () => {
		expect(Object.keys(remark.remarkListDirective)).toEqual([])
	})

	test('render the list and YouTube directives in a remark → rehype pipeline', async () => {
		const html = await unified()
			.use(remarkParse)
			.use(remark.cmsRemarkPlugins)
			.use(remarkRehype)
			.use(rehype.rehypeCmsMarker)
			.use(rehypeStringify)
			.process(':::list{.dots}\n- one\n- two\n:::\n\n::youtube{#abc_123}\n\nkey:value stays text\n')
		const code = String(html)
		expect(code).toContain('<ul class="dots"')
		expect(code).toContain('src="https://www.youtube-nocookie.com/embed/abc_123"')
		expect(code).toContain('key:value stays text')
		expect(code).toContain('data-cms-markdown-content')
	})
})
