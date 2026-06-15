import { createNodeFs, parseProjectCmsConfig, parseProjectCmsConfigSource } from '@nuasite/cms-core'
import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const LIST_STYLES = [
	{ label: 'Fajfky', class: 'checkmarks' },
	{ label: 'Růžové tečky', class: 'dots-pink' },
]

const CONFIG_SOURCE = `
	import { defineConfig } from '@nuasite/nua/config'

	export default defineConfig({
		nua: {
			cms: {
				cmsConfig: {
					listStyles: [
						{ label: 'Fajfky', class: 'checkmarks' },
						{ label: 'Růžové tečky', class: 'dots-pink' },
					],
				},
			},
		},
	})
`

const tempDirs: string[] = []

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true })
	}
})

async function tempRootWith(file: string, contents: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nua-config-'))
	tempDirs.push(dir)
	await fs.writeFile(path.join(dir, file), contents)
	return dir
}

describe('parseProjectCmsConfigSource', () => {
	test('extracts list styles from a config source string', () => {
		const config = parseProjectCmsConfigSource(CONFIG_SOURCE)
		expect(config.listStyles).toEqual(LIST_STYLES)
	})

	test('returns an empty list when listStyles is absent', () => {
		const config = parseProjectCmsConfigSource(`
			import { defineConfig } from '@nuasite/nua/config'

			export default defineConfig({
				nua: {
					cms: {
						cmsConfig: {
							openMetadataByDefault: true,
						},
					},
				},
			})
		`)

		expect(config.listStyles).toEqual([])
	})
})

describe('parseProjectCmsConfig', () => {
	test('reads astro.config.ts from the project root', async () => {
		const root = await tempRootWith('astro.config.ts', CONFIG_SOURCE)
		const config = await parseProjectCmsConfig(createNodeFs(root))
		expect(config.listStyles).toEqual(LIST_STYLES)
	})

	test('falls back to astro.config.mjs when .ts is absent', async () => {
		const root = await tempRootWith('astro.config.mjs', CONFIG_SOURCE)
		const config = await parseProjectCmsConfig(createNodeFs(root))
		expect(config.listStyles).toEqual(LIST_STYLES)
	})

	test('returns an empty config when no Astro config exists', async () => {
		const root = await tempRootWith('unrelated.txt', 'noop')
		const config = await parseProjectCmsConfig(createNodeFs(root))
		expect(config.listStyles).toEqual([])
	})
})
