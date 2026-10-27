import type { AstroConfig } from 'astro'

type MarkdownPlugins = AstroConfig['markdown']['remarkPlugins']

interface UnifiedOptions {
	remarkPlugins: MarkdownPlugins
	rehypePlugins: MarkdownPlugins
}

/**
 * The plugin lists of the site's `markdown.processor`, when it runs remark and rehype plugins.
 *
 * Since Astro 7 the plugins belong on the processor (`unified({ remarkPlugins })` from
 * `@astrojs/markdown-remark`). The top-level `markdown.remarkPlugins` / `rehypePlugins` still work, but
 * only through a deprecated bridge that warns on every run, and the default `satteri()` processor does
 * not run them at all. The check is by name, like Astro's own `isUnifiedProcessor`, so this package does
 * not load `@astrojs/markdown-remark` itself.
 */
export function unifiedOptionsOf(config: Pick<AstroConfig, 'markdown'>): UnifiedOptions | undefined {
	const processor = config.markdown?.processor
	if (processor?.name !== 'unified') return undefined
	return processor.options as UnifiedOptions
}

/**
 * Add remark and rehype plugins to the site's `markdown.processor`, so `.md` and (through
 * `extendMarkdownConfig`) `.mdx` run them. The processor object is shared by reference: Astro and
 * `@astrojs/mdx` read its `options` when they render, so adding to them in `astro:config:setup` is
 * enough. A plugin already on the list is not added again, since the hook can run more than once.
 *
 * Returns `false` when the processor does not run remark/rehype plugins (Sätteri, or a third-party one).
 */
export function addMarkdownPlugins(
	config: Pick<AstroConfig, 'markdown'>,
	plugins: { remarkPlugins?: MarkdownPlugins; rehypePlugins?: MarkdownPlugins },
): boolean {
	const options = unifiedOptionsOf(config)
	if (!options) return false
	for (const plugin of plugins.remarkPlugins ?? []) {
		if (!options.remarkPlugins.includes(plugin)) options.remarkPlugins.push(plugin)
	}
	for (const plugin of plugins.rehypePlugins ?? []) {
		if (!options.rehypePlugins.includes(plugin)) options.rehypePlugins.push(plugin)
	}
	return true
}
