import type { CmsMarkerOptions } from './types'

/** The marker options with the defaults of the Astro integration filled in. */
export function resolveMarkerConfig(options: CmsMarkerOptions): Required<CmsMarkerOptions> {
	return {
		attributeName: options.attributeName ?? 'data-cms-id',
		includeTags: options.includeTags ?? null,
		excludeTags: options.excludeTags ?? ['html', 'head', 'body', 'script', 'style'],
		includeEmptyText: options.includeEmptyText ?? false,
		generateManifest: options.generateManifest ?? true,
		manifestFile: options.manifestFile ?? 'cms-manifest.json',
		markComponents: options.markComponents ?? true,
		componentDirs: options.componentDirs ?? ['src/components'],
		contentDir: options.contentDir ?? 'src/content',
		seo: options.seo ?? { trackSeo: true, markTitle: true, parseJsonLd: true },
	}
}
