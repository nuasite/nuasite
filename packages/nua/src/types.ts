import type { MdxOptions } from '@astrojs/mdx'
import type { SitemapOptions } from '@astrojs/sitemap'
import type { CmsMarkerOptions } from '../../cms/src'
import type { PageMarkdownOptions } from '../../llm-enhancements/src'

export type { MdxOptions } from '@astrojs/mdx'
export type { SitemapOptions } from '@astrojs/sitemap'
export type { CmsMarkerOptions } from '../../cms/src'
export type { PageMarkdownOptions } from '../../llm-enhancements/src'

export interface NuaIntegrationOptions {
	/** Enable/disable or configure @nuasite/cms (default: true) */
	cms?: boolean | CmsMarkerOptions
	/** Enable/disable or configure @nuasite/llm-enhancements (default: true) */
	pageMarkdown?: boolean | PageMarkdownOptions
	/** Enable/disable or configure @astrojs/mdx (default: true) */
	mdx?: boolean | MdxOptions
	/** Enable/disable or configure @astrojs/sitemap (default: true) */
	sitemap?: boolean | SitemapOptions
	/** Enable/disable @tailwindcss/vite plugin (default: true) */
	tailwindcss?: boolean
}

export interface ResolvedIntegrationOptions {
	cms: CmsMarkerOptions | false
	pageMarkdown: PageMarkdownOptions | false
	mdx: MdxOptions | false
	sitemap: SitemapOptions | false
	tailwindcss: boolean
}

/**
 * Resolves a boolean | Options value to Options | false
 */
function resolveOption<T extends object>(value: boolean | T | undefined, defaultOptions: T = {} as T): T | false {
	if (value === false) return false
	if (value === true || value === undefined) return defaultOptions
	return value
}

export function resolveOptions(options: NuaIntegrationOptions = {}): ResolvedIntegrationOptions {
	return {
		cms: resolveOption(options.cms),
		pageMarkdown: resolveOption(options.pageMarkdown),
		mdx: resolveOption(options.mdx),
		sitemap: resolveOption(options.sitemap),
		tailwindcss: options.tailwindcss !== false,
	}
}
