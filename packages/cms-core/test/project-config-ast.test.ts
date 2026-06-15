import { createNodeFs, parseProjectCmsConfig, parseProjectCmsConfigSource } from '@nuasite/cms-core'
import { describe, expect, test } from 'bun:test'

const DETI_ROOT = '/Users/honzasladek/Projects/deti'

const DETI_LIST_STYLES = [
	{ label: 'Fajfky', class: 'checkmarks' },
	{ label: 'Růžové tečky', class: 'dots-pink' },
	{ label: 'Modré šipky', class: 'arrows-blue' },
	{ label: 'Růžové šipky', class: 'arrows-pink' },
]

describe('parseProjectCmsConfig', () => {
	test('extracts list styles from deti astro.config.ts', async () => {
		const fs = createNodeFs(DETI_ROOT)
		const config = await parseProjectCmsConfig(fs)
		expect(config.listStyles).toEqual(DETI_LIST_STYLES)
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
