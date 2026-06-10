import { defineConfig } from 'vite'

/**
 * Builds the standalone collections admin SPA into `dist-spa/` (shipped in the
 * package, served by the CLI). There is no host here, so everything —
 * collections-admin, the MDX editor, React, Milkdown — is bundled in.
 *
 * `base: './'` makes the emitted `index.html` reference assets relatively, so the
 * bundle serves correctly from the studio's `/`. JSX is compiled by esbuild (no
 * `@vitejs/plugin-react` — there is no HMR to gain in a production-only build),
 * matching the editor build in `@nuasite/cms`.
 */
export default defineConfig({
	base: './',
	build: {
		// Emit under `dist/` so the repo's tooling (oxlint `**/dist` ignore, the
		// `files: dist/**` convention) covers it without extra config.
		outDir: 'dist/spa',
		emptyOutDir: true,
	},
	esbuild: {
		jsx: 'automatic',
		jsxImportSource: 'react',
	},
	resolve: {
		dedupe: ['react', 'react-dom'],
	},
})
