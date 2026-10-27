import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [tailwindcss()],
	build: {
		lib: {
			entry: 'src/editor/index.tsx',
			formats: ['es'],
			fileName: () => 'editor.js',
		},
		rolldownOptions: {
			output: {
				codeSplitting: false,
			},
		},
	},
	oxc: {
		jsx: {
			runtime: 'automatic',
			importSource: 'preact',
		},
	},
	resolve: {
		alias: {
			'react': 'preact/compat',
			'react-dom': 'preact/compat',
			'react/jsx-runtime': 'preact/jsx-runtime',
		},
	},
})
