import fragments from '@nuasite/astro-fragments'
import { defineConfig } from 'astro/config'

export default defineConfig({
	output: 'static',
	integrations: [fragments()],
})
