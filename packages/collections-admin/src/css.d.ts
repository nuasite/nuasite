/**
 * Ambient declaration so a side-effect `import './styles.css'` typechecks in the
 * lib's own build. Hosts (webmaster) already declare `*.css` via `vite/client`,
 * and the bundler resolves the real file at build time.
 */
declare module '*.css' {
	const css: string
	export default css
}
