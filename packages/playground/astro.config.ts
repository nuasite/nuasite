import { agentsSummary } from '@nuasite/agent-summary'
import notes from '@nuasite/notes'
import { defineConfig } from '@nuasite/nua/config'

// https://astro.build/config
export default defineConfig({
	redirects: {
		'config': 'new-config',
	},
	integrations: [
		notes(),
		agentsSummary(),
	],
	nua: {
		cms: {
			cmsConfig: {
				siteTheme: 'dark',
				listStyles: [
					{ label: 'Růžové tečky', class: 'dots-pink' },
					{ label: 'Fajfky', class: 'checkmarks' },
				],
			},
		},
	},
})
