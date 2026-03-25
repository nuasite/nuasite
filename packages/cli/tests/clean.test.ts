import { describe, expect, test } from 'bun:test'
import { detectDisabledFeatures, extractConfigBody, removeProperty, transformConfig, transformPackageJson } from '../src/clean'

describe('detectDisabledFeatures', () => {
	test('detects disabled features', () => {
		const content = `nua: { sitemap: false, mdx: false }`
		const disabled = detectDisabledFeatures(content)
		expect(disabled.has('sitemap')).toBe(true)
		expect(disabled.has('mdx')).toBe(true)
		expect(disabled.has('tailwindcss')).toBe(false)
	})

	test('returns empty set when nothing is disabled', () => {
		const content = `nua: { sitemap: true }`
		const disabled = detectDisabledFeatures(content)
		expect(disabled.size).toBe(0)
	})
})

describe('extractConfigBody', () => {
	test('extracts body from defineConfig', () => {
		const content = `export default defineConfig({\n\tsite: 'https://example.com',\n})`
		const body = extractConfigBody(content)
		expect(body).toContain("site: 'https://example.com'")
	})

	test('returns empty string for defineConfig with no object', () => {
		const content = `export default defineConfig()`
		const body = extractConfigBody(content)
		expect(body).toBe('')
	})

	test('handles nested objects', () => {
		const content = `export default defineConfig({\n\tnua: {\n\t\tcms: { editPath: '/edit' },\n\t},\n})`
		const body = extractConfigBody(content)
		expect(body).toContain('nua:')
		expect(body).toContain('editPath')
	})
})

describe('removeProperty', () => {
	test('removes simple property', () => {
		const body = `\n\tsite: 'https://example.com',\n\tnua: false,\n`
		const result = removeProperty(body, 'nua')
		expect(result).toContain('site')
		expect(result).not.toContain('nua')
	})

	test('removes object property', () => {
		const body = `\n\tsite: 'https://example.com',\n\tnua: {\n\t\tsitemap: false,\n\t},\n`
		const result = removeProperty(body, 'nua')
		expect(result).toContain('site')
		expect(result).not.toContain('nua')
		expect(result).not.toContain('sitemap')
	})

	test('returns body unchanged if property not found', () => {
		const body = `\n\tsite: 'https://example.com',\n`
		const result = removeProperty(body, 'nua')
		expect(result).toBe(body)
	})
})

describe('transformConfig', () => {
	test('converts basic nua/config pattern', () => {
		const input = [
			`import { defineConfig } from '@nuasite/nua/config'`,
			``,
			`export default defineConfig({`,
			`\tsite: 'https://example.com',`,
			`})`,
			``,
		].join('\n')

		const result = transformConfig(input, new Set())

		expect(result).toContain(`import { defineConfig } from 'astro/config'`)
		expect(result).toContain(`import tailwindcss from '@tailwindcss/vite'`)
		expect(result).toContain(`import mdx from '@astrojs/mdx'`)
		expect(result).toContain(`import sitemap from '@astrojs/sitemap'`)
		expect(result).toContain(`site: 'https://example.com'`)
		expect(result).toContain('integrations: [mdx(), sitemap()]')
		expect(result).toContain('plugins: [tailwindcss()]')
		expect(result).not.toContain('@nuasite')
	})

	test('skips disabled features', () => {
		const input = [
			`import { defineConfig } from '@nuasite/nua/config'`,
			``,
			`export default defineConfig({`,
			`\tsite: 'https://example.com',`,
			`\tnua: {`,
			`\t\tsitemap: false,`,
			`\t},`,
			`})`,
			``,
		].join('\n')

		const result = transformConfig(input, new Set(['sitemap']))

		expect(result).toContain(`import mdx from '@astrojs/mdx'`)
		expect(result).not.toContain(`import sitemap`)
		expect(result).toContain('integrations: [mdx()]')
		expect(result).not.toContain('sitemap()')
	})

	test('preserves user imports', () => {
		const input = [
			`import { defineConfig } from '@nuasite/nua/config'`,
			`import node from '@astrojs/node'`,
			``,
			`export default defineConfig({`,
			`\tsite: 'https://example.com',`,
			`\tadapter: node({ mode: 'standalone' }),`,
			`})`,
			``,
		].join('\n')

		const result = transformConfig(input, new Set())

		expect(result).toContain(`import node from '@astrojs/node'`)
		expect(result).toContain(`adapter: node({ mode: 'standalone' })`)
	})

	test('merges into existing integrations array', () => {
		const input = [
			`import { defineConfig } from '@nuasite/nua/config'`,
			`import react from '@astrojs/react'`,
			``,
			`export default defineConfig({`,
			`\tintegrations: [react()],`,
			`})`,
			``,
		].join('\n')

		const result = transformConfig(input, new Set())

		expect(result).toContain(`import react from '@astrojs/react'`)
		expect(result).toMatch(/integrations:\s*\[mdx\(\), sitemap\(\), react\(\)\]/)
	})

	test('merges tailwindcss into existing vite plugins', () => {
		const input = [
			`import { defineConfig } from '@nuasite/nua/config'`,
			`import myPlugin from 'vite-plugin-foo'`,
			``,
			`export default defineConfig({`,
			`\tvite: {`,
			`\t\tplugins: [myPlugin()],`,
			`\t},`,
			`})`,
			``,
		].join('\n')

		const result = transformConfig(input, new Set())

		expect(result).toContain(`import myPlugin from 'vite-plugin-foo'`)
		expect(result).toMatch(/plugins:\s*\[tailwindcss\(\), myPlugin\(\)\]/)
		// Should not add a second vite block
		expect(result.match(/vite:/g)?.length).toBe(1)
	})

	test('handles nua/integration pattern', () => {
		const input = [
			`import { defineConfig } from 'astro/config'`,
			`import nua from '@nuasite/nua/integration'`,
			``,
			`export default defineConfig({`,
			`\tintegrations: [nua()],`,
			`})`,
			``,
		].join('\n')

		const result = transformConfig(input, new Set())

		expect(result).not.toContain('@nuasite')
		expect(result).not.toContain('nua()')
		expect(result).toContain('mdx()')
		expect(result).toContain('sitemap()')
	})

	test('handles empty defineConfig', () => {
		const input = [
			`import { defineConfig } from '@nuasite/nua/config'`,
			``,
			`export default defineConfig({})`,
			``,
		].join('\n')

		const result = transformConfig(input, new Set())

		expect(result).toContain(`import { defineConfig } from 'astro/config'`)
		expect(result).toContain('integrations: [mdx(), sitemap()]')
		expect(result).toContain('plugins: [tailwindcss()]')
	})

	test('handles all features disabled', () => {
		const input = [
			`import { defineConfig } from '@nuasite/nua/config'`,
			``,
			`export default defineConfig({`,
			`\tsite: 'https://example.com',`,
			`\tnua: {`,
			`\t\tmdx: false,`,
			`\t\tsitemap: false,`,
			`\t\ttailwindcss: false,`,
			`\t},`,
			`})`,
			``,
		].join('\n')

		const disabled = new Set(['mdx', 'sitemap', 'tailwindcss'])
		const result = transformConfig(input, disabled)

		expect(result).not.toContain('mdx')
		expect(result).not.toContain('sitemap')
		expect(result).not.toContain('tailwindcss')
		expect(result).toContain(`site: 'https://example.com'`)
	})
})

describe('transformPackageJson', () => {
	test('removes @nuasite packages and adds standard ones', () => {
		const pkg = {
			name: 'my-site',
			scripts: {
				dev: 'astro dev',
				build: 'nua build',
				preview: 'astro preview',
			},
			dependencies: {
				'@nuasite/nua': 'workspace:*',
			},
		}

		const result = transformPackageJson(pkg, new Set())

		expect(result.dependencies['@nuasite/nua']).toBeUndefined()
		expect(result.dependencies['astro']).toBeDefined()
		expect(result.dependencies['@astrojs/mdx']).toBeDefined()
		expect(result.dependencies['@astrojs/sitemap']).toBeDefined()
		expect(result.dependencies['@tailwindcss/vite']).toBeDefined()
		expect(result.dependencies['typescript']).toBeDefined()
		expect(result.scripts.build).toBe('astro build')
	})

	test('updates all nua script references', () => {
		const pkg = {
			scripts: {
				dev: 'nua dev',
				build: 'nua build',
				preview: 'nua preview',
			},
			dependencies: {},
		}

		const result = transformPackageJson(pkg, new Set())

		expect(result.scripts.dev).toBe('astro dev')
		expect(result.scripts.build).toBe('astro build')
		expect(result.scripts.preview).toBe('astro preview')
	})

	test('skips disabled feature packages', () => {
		const pkg = {
			dependencies: { '@nuasite/nua': '^0.16.0' },
		}

		const result = transformPackageJson(pkg, new Set(['mdx', 'sitemap']))

		expect(result.dependencies['@astrojs/mdx']).toBeUndefined()
		expect(result.dependencies['@astrojs/sitemap']).toBeUndefined()
		expect(result.dependencies.astro).toBeDefined()
	})

	test('does not override existing package versions', () => {
		const pkg = {
			dependencies: {
				'@nuasite/nua': '^0.16.0',
				'astro': '^5.0.0',
			},
		}

		const result = transformPackageJson(pkg, new Set())

		expect(result.dependencies.astro).toBe('^5.0.0')
	})

	test('removes tooling @nuasite packages from all dependency fields', () => {
		const pkg = {
			dependencies: { '@nuasite/nua': '^0.16.0' },
			devDependencies: { '@nuasite/cli': '^0.16.0' },
			peerDependencies: { '@nuasite/core': '^0.16.0' },
		}

		const result = transformPackageJson(pkg, new Set())

		expect(result.devDependencies).toBeUndefined() // empty → removed
		expect(result.peerDependencies).toBeUndefined()
		expect(result.dependencies['@nuasite/nua']).toBeUndefined()
	})

	test('promotes runtime packages to explicit deps when used', () => {
		const pkg = {
			dependencies: { '@nuasite/nua': '^0.16.0' },
		}

		const result = transformPackageJson(pkg, new Set(), ['@nuasite/components'])

		expect(result.dependencies['@nuasite/components']).toBe('^0.16.0')
		expect(result.dependencies['@nuasite/nua']).toBeUndefined()
	})

	test('uses nua version for promoted runtime packages', () => {
		const pkg = {
			dependencies: { '@nuasite/nua': 'workspace:*' },
		}

		const result = transformPackageJson(pkg, new Set(), ['@nuasite/components'])

		expect(result.dependencies['@nuasite/components']).toBe('workspace:*')
	})

	test('does not remove @nuasite/components if already explicit', () => {
		const pkg = {
			dependencies: {
				'@nuasite/nua': '^0.16.0',
				'@nuasite/components': '^0.15.0',
			},
		}

		const result = transformPackageJson(pkg, new Set(), ['@nuasite/components'])

		expect(result.dependencies['@nuasite/components']).toBe('^0.15.0')
	})

	test('sorts dependencies alphabetically', () => {
		const pkg = {
			dependencies: { '@nuasite/nua': '^0.16.0' },
		}

		const result = transformPackageJson(pkg, new Set())
		const keys = Object.keys(result.dependencies)

		for (let i = 1; i < keys.length; i++) {
			expect(keys[i]! > keys[i - 1]!).toBe(true)
		}
	})
})
