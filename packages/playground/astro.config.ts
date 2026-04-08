import nuaNotes from '@nuasite/notes'
import { defineConfig } from '@nuasite/nua/config'

// https://astro.build/config
export default defineConfig({
	redirects: {
		'config': 'new-config',
	},
	integrations: [
		nuaNotes(),
	],
})
