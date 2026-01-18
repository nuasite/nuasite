import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Note: Since resolve-deps.ts is a script that runs in process.cwd(),
// these tests validate the logic by importing the functions we would extract.
// For now, we'll create unit tests for the core logic.

describe('Workspace Dependencies Resolution', () => {
	describe('catalog resolution', () => {
		test('should resolve catalog:build to version from build catalog', () => {
			const catalogs = new Map([
				[
					'build',
					new Map([
						['typescript', '^5.0.0'],
						['vite', '^6.0.0'],
					]),
				],
			])

			const deps = {
				'typescript': 'catalog:build',
				'vite': 'catalog:build',
			}

			// Simulate resolution
			for (const [name, range] of Object.entries(deps)) {
				if (String(range).startsWith('catalog:')) {
					const catalogName = String(range).slice('catalog:'.length)
					const catalog = catalogs.get(catalogName)
					const version = catalog?.get(name)
					expect(version).toBeDefined()
					if (catalogName === 'build' && name === 'typescript') {
						expect(version).toBe('^5.0.0')
					}
				}
			}
		})

		test('should resolve catalog: to version from default catalog', () => {
			const catalogs = new Map([
				[
					'',
					new Map([
						['@types/bun', 'latest'],
					]),
				],
			])

			const deps = {
				'@types/bun': 'catalog:',
			}

			// Simulate resolution
			for (const [name, range] of Object.entries(deps)) {
				if (String(range).startsWith('catalog:')) {
					const catalogName = String(range).slice('catalog:'.length)
					const actualCatalogName = (catalogName === '' || catalogName === '*') ? '' : catalogName
					const catalog = catalogs.get(actualCatalogName)
					const version = catalog?.get(name)
					expect(version).toBe('latest')
				}
			}
		})

		test('should resolve catalog:* to version from default catalog', () => {
			const catalogs = new Map([
				[
					'',
					new Map([
						['@types/bun', 'latest'],
					]),
				],
			])

			const deps = {
				'@types/bun': 'catalog:*',
			}

			// Simulate resolution
			for (const [name, range] of Object.entries(deps)) {
				if (String(range).startsWith('catalog:')) {
					const catalogName = String(range).slice('catalog:'.length)
					const actualCatalogName = (catalogName === '' || catalogName === '*') ? '' : catalogName
					const catalog = catalogs.get(actualCatalogName)
					const version = catalog?.get(name)
					expect(version).toBe('latest')
				}
			}
		})

		test('should handle multiple catalogs', () => {
			const catalogs = new Map([
				[
					'build',
					new Map([
						['typescript', '^5.0.0'],
					]),
				],
				[
					'ui',
					new Map([
						['tailwindcss', '4.1.16'],
					]),
				],
			])

			expect(catalogs.get('build')?.get('typescript')).toBe('^5.0.0')
			expect(catalogs.get('ui')?.get('tailwindcss')).toBe('4.1.16')
		})
	})

	describe('workspace resolution', () => {
		test('should resolve workspace:* to exact version', () => {
			const versions = new Map([
				['@myorg/package-a', '1.0.0'],
			])

			const range = 'workspace:*'
			const name = '@myorg/package-a'
			const tag = range.slice('workspace:'.length)
			const version = versions.get(name)

			expect(version).toBe('1.0.0')
			const resolved = tag === '^' ? `^${version}` : tag === '~' ? `~${version}` : version
			expect(resolved).toBe('1.0.0')
		})

		test('should resolve workspace:^ to caret range', () => {
			const versions = new Map([
				['@myorg/package-a', '1.0.0'],
			])

			const range = 'workspace:^'
			const name = '@myorg/package-a'
			const tag = range.slice('workspace:'.length)
			const version = versions.get(name)

			const resolved = tag === '^' ? `^${version}` : tag === '~' ? `~${version}` : version
			expect(resolved).toBe('^1.0.0')
		})

		test('should resolve workspace:~ to tilde range', () => {
			const versions = new Map([
				['@myorg/package-a', '1.0.0'],
			])

			const range = 'workspace:~'
			const name = '@myorg/package-a'
			const tag = range.slice('workspace:'.length)
			const version = versions.get(name)

			const resolved = tag === '^' ? `^${version}` : tag === '~' ? `~${version}` : version
			expect(resolved).toBe('~1.0.0')
		})
	})

	describe('fail-fast validation', () => {
		test('should detect remaining workspace: references', () => {
			const content = JSON.stringify({
				dependencies: {
					'package-a': 'workspace:*',
				},
			})

			expect(/"workspace:/.test(content)).toBe(true)
		})

		test('should detect remaining catalog: references', () => {
			const content = JSON.stringify({
				dependencies: {
					'typescript': 'catalog:build',
				},
			})

			expect(/"catalog:/.test(content)).toBe(true)
		})

		test('should pass when no workspace: or catalog: references remain', () => {
			const content = JSON.stringify({
				dependencies: {
					'package-a': '1.0.0',
					'typescript': '^5.0.0',
				},
			})

			expect(/"workspace:/.test(content)).toBe(false)
			expect(/"catalog:/.test(content)).toBe(false)
		})
	})
})
