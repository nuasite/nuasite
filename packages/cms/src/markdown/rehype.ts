import { withPortableModule } from './portable-module'

/**
 * Rehype plugin that marks the first element of rendered markdown/MDX content
 * with `data-cms-markdown-content`. The HTML processor uses this marker to
 * reliably identify the wrapper element (the marker's parent) instead of
 * relying on heuristics.
 */
export const rehypeCmsMarker = withPortableModule(function rehypeCmsMarker() {
	return (tree: any, file: any) => {
		const firstElement = tree.children?.find((n: any) => n.type === 'element')
		if (firstElement) {
			firstElement.properties ??= {}
			firstElement.properties['dataCmsMarkdownContent'] = file?.path ?? (Array.isArray(file?.history) ? file.history[0] : '') ?? ''
		}
	}
}, { module: '@nuasite/cms/rehype', export: 'rehypeCmsMarker' })
