// @ts-check
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import pageMarkdown from '@nuasite/page-markdown'
import cmsMarker from '@nuasite/cms-marker'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
	vite: {
		plugins: [tailwindcss()],
	},
	integrations: [cmsMarker(), pageMarkdown(), mdx(), sitemap()],
})
