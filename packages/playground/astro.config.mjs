// @ts-check
import cmsMarker from '@nuasite/cms-marker'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
	vite: {
		plugins: [tailwindcss()],
	},
	integrations: [cmsMarker()],
})
