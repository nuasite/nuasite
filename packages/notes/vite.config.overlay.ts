import { defineConfig } from 'vite'

/**
 * Bundle the notes overlay into a standalone ES module that gets shipped
 * as `dist/overlay.js`. The integration loads this bundle as a virtual
 * module when notes is installed from npm (so consumers don't need to
 * install preact themselves). In the monorepo's playground, where this
 * bundle is absent, the integration falls back to serving source .tsx
 * files through Vite's on-the-fly compilation.
 *
 * Mirrors `packages/cms/vite.config.editor.ts` so both packages have
 * matching shipping behavior.
 */
export default defineConfig({
	build: {
		lib: {
			entry: 'src/overlay/index.tsx',
			formats: ['es'],
			fileName: () => 'overlay.js',
		},
		rollupOptions: {
			output: {
				inlineDynamicImports: true,
			},
		},
		// Notes is dev-only and the overlay is small enough that minification
		// adds little value while making debugging in DevTools harder.
		minify: false,
	},
	esbuild: {
		jsx: 'automatic',
		jsxImportSource: 'preact',
	},
	resolve: {
		alias: {
			'react': 'preact/compat',
			'react-dom': 'preact/compat',
			'react/jsx-runtime': 'preact/jsx-runtime',
		},
	},
})
