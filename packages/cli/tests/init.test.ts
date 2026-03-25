import { describe, expect, test } from 'bun:test'
import { cleanEmptyStructures, detectNuaManagedImports, removeCallFromArray, transformConfig, transformPackageJson } from '../src/init'

describe('detectNuaManagedImports', () => {
	test('detects all managed imports', () => {
		const content = [
			`import mdx from '@astrojs/mdx'`,
			`import sitemap from '@astrojs/sitemap'`,
			`import tailwindcss from '@tailwindcss/vite'`,
		].join('\n')
		const managed = detectNuaManagedImports(content)
		expect(managed.size).toBe(3)
		expect(managed.get('@astrojs/mdx')).toBe('mdx')
		expect(managed.get('@astrojs/sitemap')).toBe('sitemap')
		expect(managed.get('@tailwindcss/vite')).toBe('tailwindcss')
	})

	test('detects subset of managed imports', () => {
		const content = `import mdx from '@astrojs/mdx'`
		const managed = detectNuaManagedImports(content)
		expect(managed.size).toBe(1)
		expect(managed.get('@astrojs/mdx')).toBe('mdx')
	})

	test('returns empty map when no managed imports', () => {
		const content = `import react from '@astrojs/react'`
		const managed = detectNuaManagedImports(content)
		expect(managed.size).toBe(0)
	})

	test('handles non-standard local names', () => {
		const content = `import tw from '@tailwindcss/vite'`
		const managed = detectNuaManagedImports(content)
		expect(managed.get('@tailwindcss/vite')).toBe('tw')
	})
})

describe('removeCallFromArray', () => {
	test('removes simple call from array', () => {
		const body = `\n\tintegrations: [mdx(), sitemap()],\n`
		const result = removeCallFromArray(body, 'integrations', 'mdx')
		expect(result).toContain('sitemap()')
		expect(result).not.toContain('mdx')
	})

	test('removes call with arguments', () => {
		const body = `\n\tintegrations: [sitemap({ filter: true })],\n`
		const result = removeCallFromArray(body, 'integrations', 'sitemap')
		expect(result).not.toContain('sitemap')
	})

	test('preserves other items when removing from middle', () => {
		const body = `\n\tintegrations: [react(), mdx(), sitemap()],\n`
		const result = removeCallFromArray(body, 'integrations', 'mdx')
		expect(result).toContain('react()')
		expect(result).toContain('sitemap()')
		expect(result).not.toContain('mdx')
	})

	test('returns body unchanged if call not found', () => {
		const body = `\n\tintegrations: [react()],\n`
		const result = removeCallFromArray(body, 'integrations', 'mdx')
		expect(result).toBe(body)
	})

	test('returns body unchanged if array property not found', () => {
		const body = `\n\tsite: 'https://example.com',\n`
		const result = removeCallFromArray(body, 'integrations', 'mdx')
		expect(result).toBe(body)
	})

	test('removes multiline call with arguments', () => {
		const body = [
			'',
			'\tintegrations: [',
			'\t\tsitemap({',
			"\t\t\tfilter: (page) => page !== '/secret',",
			'\t\t}),',
			'\t\treact(),',
			'\t],',
		].join('\n')
		const result = removeCallFromArray(body, 'integrations', 'sitemap')
		expect(result).not.toContain('sitemap')
		expect(result).toContain('react()')
	})
})

describe('cleanEmptyStructures', () => {
	test('removes empty integrations array', () => {
		const body = `\n\tsite: 'x',\n\tintegrations: [],\n`
		const result = cleanEmptyStructures(body)
		expect(result).not.toContain('integrations')
		expect(result).toContain('site')
	})

	test('removes empty vite object', () => {
		const body = `\n\tsite: 'x',\n\tvite: {},\n`
		const result = cleanEmptyStructures(body)
		expect(result).not.toContain('vite')
		expect(result).toContain('site')
	})

	test('removes vite with only sourcemap: true default', () => {
		const body = [
			'',
			'\tvite: {',
			'\t\tbuild: {',
			'\t\t\tsourcemap: true,',
			'\t\t},',
			'\t},',
		].join('\n')
		const result = cleanEmptyStructures(body)
		expect(result.trim()).toBe('')
	})

	test('preserves non-empty vite config', () => {
		const body = [
			'',
			'\tvite: {',
			"\t\tssr: { noExternal: ['x'] },",
			'\t},',
		].join('\n')
		const result = cleanEmptyStructures(body)
		expect(result).toContain('vite')
		expect(result).toContain('ssr')
	})

	test('removes empty plugins array', () => {
		const body = `\n\tvite: {\n\t\tplugins: [],\n\t},\n`
		const result = cleanEmptyStructures(body)
		expect(result).not.toContain('plugins')
	})
})

describe('transformConfig', () => {
	function transform(input: string): string {
		return transformConfig(input, detectNuaManagedImports(input))
	}

	test('converts full astro config to nua config', () => {
		const input = [
			`import { defineConfig } from 'astro/config'`,
			`import mdx from '@astrojs/mdx'`,
			`import sitemap from '@astrojs/sitemap'`,
			`import tailwindcss from '@tailwindcss/vite'`,
			``,
			`export default defineConfig({`,
			`\tsite: 'https://example.com',`,
			`\tintegrations: [mdx(), sitemap()],`,
			`\tvite: {`,
			`\t\tbuild: {`,
			`\t\t\tsourcemap: true,`,
			`\t\t},`,
			`\t\tplugins: [tailwindcss()],`,
			`\t},`,
			`})`,
		].join('\n')

		const result = transform(input)

		expect(result).toContain(`import { defineConfig } from '@nuasite/nua/config'`)
		expect(result).not.toContain('@astrojs/mdx')
		expect(result).not.toContain('@astrojs/sitemap')
		expect(result).not.toContain('@tailwindcss/vite')
		expect(result).toContain(`site: 'https://example.com'`)
		expect(result).not.toContain('integrations')
		expect(result).not.toContain('vite')
		expect(result).not.toContain('plugins')
	})

	test('preserves user integrations', () => {
		const input = [
			`import { defineConfig } from 'astro/config'`,
			`import mdx from '@astrojs/mdx'`,
			`import react from '@astrojs/react'`,
			``,
			`export default defineConfig({`,
			`\tintegrations: [mdx(), react()],`,
			`})`,
		].join('\n')

		const result = transform(input)

		expect(result).toContain(`import react from '@astrojs/react'`)
		expect(result).toContain('react()')
		expect(result).not.toContain('mdx')
	})

	test('preserves user vite plugins', () => {
		const input = [
			`import { defineConfig } from 'astro/config'`,
			`import tailwindcss from '@tailwindcss/vite'`,
			`import myPlugin from 'vite-plugin-foo'`,
			``,
			`export default defineConfig({`,
			`\tvite: {`,
			`\t\tplugins: [tailwindcss(), myPlugin()],`,
			`\t},`,
			`})`,
		].join('\n')

		const result = transform(input)

		expect(result).toContain(`import myPlugin from 'vite-plugin-foo'`)
		expect(result).toContain('myPlugin()')
		expect(result).not.toContain('tailwindcss')
	})

	test('handles config with only some managed packages', () => {
		const input = [
			`import { defineConfig } from 'astro/config'`,
			`import mdx from '@astrojs/mdx'`,
			``,
			`export default defineConfig({`,
			`\tintegrations: [mdx()],`,
			`})`,
		].join('\n')

		const result = transform(input)

		expect(result).toContain(`import { defineConfig } from '@nuasite/nua/config'`)
		expect(result).not.toContain('@astrojs/mdx')
		expect(result).not.toContain('integrations')
	})

	test('handles empty defineConfig', () => {
		const input = [
			`import { defineConfig } from 'astro/config'`,
			``,
			`export default defineConfig({})`,
		].join('\n')

		const result = transform(input)

		expect(result).toContain(`import { defineConfig } from '@nuasite/nua/config'`)
		expect(result).toContain('export default defineConfig({\n})')
	})

	test('handles config with no managed packages', () => {
		const input = [
			`import { defineConfig } from 'astro/config'`,
			`import react from '@astrojs/react'`,
			``,
			`export default defineConfig({`,
			`\tsite: 'https://example.com',`,
			`\tintegrations: [react()],`,
			`})`,
		].join('\n')

		const result = transform(input)

		expect(result).toContain(`import { defineConfig } from '@nuasite/nua/config'`)
		expect(result).toContain(`import react from '@astrojs/react'`)
		expect(result).toContain('integrations')
		expect(result).toContain('react()')
	})

	test('preserves sourcemap with non-true value', () => {
		const input = [
			`import { defineConfig } from 'astro/config'`,
			``,
			`export default defineConfig({`,
			`\tvite: {`,
			`\t\tbuild: {`,
			`\t\t\tsourcemap: 'hidden',`,
			`\t\t},`,
			`\t},`,
			`})`,
		].join('\n')

		const result = transform(input)

		expect(result).toContain(`sourcemap: 'hidden'`)
	})

	test('handles multiline integration calls', () => {
		const input = [
			`import { defineConfig } from 'astro/config'`,
			`import sitemap from '@astrojs/sitemap'`,
			`import react from '@astrojs/react'`,
			``,
			`export default defineConfig({`,
			`\tintegrations: [`,
			`\t\tsitemap({`,
			`\t\t\tfilter: (page) => page !== '/secret',`,
			`\t\t}),`,
			`\t\treact(),`,
			`\t],`,
			`})`,
		].join('\n')

		const result = transform(input)

		expect(result).not.toContain('sitemap')
		expect(result).toContain('react()')
	})
})

describe('transformPackageJson', () => {
	const nuaVersion = '^0.17.0'

	test('removes Nua-provided packages and adds @nuasite/nua', () => {
		const pkg = {
			name: 'my-site',
			scripts: {
				dev: 'astro dev',
				build: 'astro build',
			},
			dependencies: {
				'astro': '^6.0.2',
				'@astrojs/mdx': '^5.0.0',
				'@astrojs/sitemap': '^3.7.1',
				'@tailwindcss/vite': '^4.2.1',
				'tailwindcss': '^4.2.1',
				'typescript': '^5',
			},
		}

		const result = transformPackageJson(pkg, nuaVersion)

		expect(result.dependencies['@astrojs/mdx']).toBeUndefined()
		expect(result.dependencies['@astrojs/sitemap']).toBeUndefined()
		expect(result.dependencies['@tailwindcss/vite']).toBeUndefined()
		expect(result.dependencies.tailwindcss).toBeUndefined()
		expect(result.dependencies['@nuasite/nua']).toBeDefined()
		expect(result.dependencies.astro).toBe('^6.0.2')
		expect(result.dependencies.typescript).toBe('^5')
	})

	test('updates scripts: astro -> nua', () => {
		const pkg = {
			scripts: {
				dev: 'astro dev',
				build: 'astro build',
				preview: 'astro preview',
				check: 'astro check',
			},
			dependencies: {},
		}

		const result = transformPackageJson(pkg, nuaVersion)

		expect(result.scripts.dev).toBe('nua dev')
		expect(result.scripts.build).toBe('nua build')
		expect(result.scripts.preview).toBe('nua preview')
		expect(result.scripts.check).toBe('astro check')
	})

	test('preserves packages not provided by Nua', () => {
		const pkg = {
			dependencies: {
				'astro': '^6.0.2',
				'@astrojs/check': '^0.9.7',
				'@astrojs/rss': '^4.0.17',
				'@astrojs/react': '^4.0.0',
				'typescript': '^5',
			},
		}

		const result = transformPackageJson(pkg, nuaVersion)

		expect(result.dependencies.astro).toBe('^6.0.2')
		expect(result.dependencies['@astrojs/check']).toBe('^0.9.7')
		expect(result.dependencies['@astrojs/rss']).toBe('^4.0.17')
		expect(result.dependencies['@astrojs/react']).toBe('^4.0.0')
	})

	test('does not override existing @nuasite/nua version', () => {
		const pkg = {
			dependencies: {
				'@nuasite/nua': '^0.16.0',
			},
		}

		const result = transformPackageJson(pkg, nuaVersion)

		expect(result.dependencies['@nuasite/nua']).toBe('^0.16.0')
	})

	test('removes Nua-provided packages from devDependencies', () => {
		const pkg = {
			dependencies: { 'astro': '^6.0.2' },
			devDependencies: {
				'@tailwindcss/vite': '^4.2.1',
				'tailwindcss': '^4.2.1',
			},
		}

		const result = transformPackageJson(pkg, nuaVersion)

		expect(result.devDependencies).toBeUndefined()
	})

	test('sorts dependencies alphabetically', () => {
		const pkg = {
			dependencies: {
				'typescript': '^5',
				'astro': '^6.0.2',
				'@astrojs/mdx': '^5.0.0',
			},
		}

		const result = transformPackageJson(pkg, nuaVersion)
		const keys = Object.keys(result.dependencies)
		for (let i = 1; i < keys.length; i++) {
			expect(keys[i]! > keys[i - 1]!).toBe(true)
		}
	})

	test('handles missing scripts field', () => {
		const pkg = { dependencies: { 'astro': '^6.0.2' } }
		const result = transformPackageJson(pkg, nuaVersion)
		expect(result.dependencies['@nuasite/nua']).toBeDefined()
	})

	test('handles missing dependencies field', () => {
		const pkg = { name: 'my-site' }
		const result = transformPackageJson(pkg, nuaVersion)
		expect(result.dependencies['@nuasite/nua']).toBeDefined()
	})
})
