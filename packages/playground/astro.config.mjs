// @ts-check
import nua from '@nuasite/nua/integration'
import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
	integrations: [nua()],
})
