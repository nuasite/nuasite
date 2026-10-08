/**
 * Test preload: compile the in-page editor's `.tsx` against Preact.
 *
 * The editor is Preact, and everything that builds it says so — `vite.config.editor.ts`, and
 * the `nuasite-cms-preact-jsx` transform the integration installs for monorepo dev, which
 * prepends this same pragma. `bun test` runs from the repo root and takes its JSX settings
 * from there, where the import source is React (`collections-admin` and `cms-mdx-editor` are
 * React), so without this an editor component returns frozen React elements and cannot be
 * rendered at all. Scoped to `packages/cms/src/editor`, so the React packages are untouched.
 */
import { plugin } from 'bun'

plugin({
	name: 'nuasite-cms-editor-preact-jsx',
	setup(build) {
		build.onLoad({ filter: /[\\/]packages[\\/]cms[\\/]src[\\/]editor[\\/].*\.tsx$/ }, async ({ path }) => {
			const source = await Bun.file(path).text()
			return { contents: source.includes('@jsxImportSource') ? source : `/** @jsxImportSource preact */\n${source}`, loader: 'tsx' }
		})
	},
})
