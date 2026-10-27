import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compileExports } from './compiled-exports.ts'

function packageWith(files: string[]): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compiled-exports-'))
	for (const file of files) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
		fs.writeFileSync(path.join(dir, file), '')
	}
	return dir
}

describe('compileExports', () => {
	test('points import, default and types at dist/, keeping workerd and non-source targets', () => {
		const dir = packageWith(['dist/index.js', 'dist/index.d.ts', 'dist/markdown/remark.js', 'dist/markdown/remark.d.ts'])
		const json = {
			module: './src/index.ts',
			exports: {
				'.': { types: './src/index.ts', workerd: './src/fields.ts', import: './src/index.ts', default: './src/index.ts' },
				'./remark': { types: './src/markdown/remark.ts', import: './src/markdown/remark.ts' },
				'./styles.css': './src/styles.css',
				'./package.json': './package.json',
			},
		}
		expect(compileExports(json, dir)).toEqual([])
		expect(json).toEqual({
			module: './dist/index.js',
			exports: {
				'.': { types: './dist/index.d.ts', workerd: './src/fields.ts', import: './dist/index.js', default: './dist/index.js' },
				'./remark': { types: './dist/markdown/remark.d.ts', import: './dist/markdown/remark.js' },
				'./styles.css': './src/styles.css',
				'./package.json': './package.json',
			},
		})
	})

	test('reports targets that were not built', () => {
		const dir = packageWith(['dist/index.js'])
		const json = { exports: { '.': { types: './src/index.ts', import: './src/index.ts' } } }
		expect(compileExports(json, dir)).toEqual(['./dist/index.d.ts'])
	})

	test('rewrites subpath imports too', () => {
		const dir = packageWith(['dist/project/default-node.js', 'dist/project/default-node.d.ts'])
		const json = {
			imports: {
				'#project-context-default': {
					types: './src/project/default-node.ts',
					workerd: './src/project/default-none.ts',
					default: './src/project/default-node.ts',
				},
			},
		}
		expect(compileExports(json, dir)).toEqual([])
		expect(json.imports['#project-context-default']).toEqual({
			types: './dist/project/default-node.d.ts',
			workerd: './src/project/default-none.ts',
			default: './dist/project/default-node.js',
		})
	})

	test('rewrites a target written without ./', () => {
		const dir = packageWith(['dist/index.js'])
		const json = { module: 'src/index.ts' }
		expect(compileExports(json, dir)).toEqual([])
		expect(json.module).toBe('./dist/index.js')
	})

	test('maps a .tsx source to .js', () => {
		const dir = packageWith(['dist/app.js'])
		const json = { exports: { '.': { import: './src/app.tsx' } } }
		expect(compileExports(json, dir)).toEqual([])
		expect(json.exports['.'].import).toBe('./dist/app.js')
	})
})
