import type { CheckRunner } from './check-runner.ts'
import type { ResolvedChecksOptions } from './types.ts'

// SEO checks
import { createBrokenInternalLinksCheck } from './checks/seo/broken-internal-links-check.ts'
import { createCanonicalInvalidCheck, createCanonicalMismatchCheck, createCanonicalMissingCheck } from './checks/seo/canonical-check.ts'
import { createDescriptionLengthCheck, createDescriptionMissingCheck } from './checks/seo/description-check.ts'
import { createHeadingSkipCheck, createMultipleH1Check, createNoH1Check } from './checks/seo/heading-hierarchy-check.ts'
import { createImageAltMissingCheck } from './checks/seo/image-alt-check.ts'
import { createImageAltQualityCheck } from './checks/seo/image-alt-quality-check.ts'
import { createJsonLdInvalidCheck } from './checks/seo/json-ld-check.ts'
import { createMetaDuplicateCheck } from './checks/seo/meta-duplicates-check.ts'
import { createNoindexDetectedCheck } from './checks/seo/noindex-check.ts'
import { createOgDescriptionCheck, createOgImageCheck, createOgTitleCheck } from './checks/seo/open-graph-check.ts'
import { createRobotsTxtCheck, createSitemapXmlCheck } from './checks/seo/sitemap-robots-check.ts'
import { createTitleEmptyCheck, createTitleLengthCheck, createTitleMissingCheck } from './checks/seo/title-check.ts'
import { createTwitterCardCheck } from './checks/seo/twitter-card-check.ts'
import { createViewportMissingCheck } from './checks/seo/viewport-check.ts'

// GEO checks
import { createContentTooShortCheck, createInsufficientHeadingsCheck } from './checks/geo/content-quality-check.ts'
import { createLlmsTxtCheck } from './checks/geo/llms-txt-check.ts'

// Performance checks
import { createHtmlSizeCheck } from './checks/performance/html-size-check.ts'
import { createImageFormatCheck, createImageSizeCheck } from './checks/performance/image-optimization-check.ts'
import { createInlineSizeCheck } from './checks/performance/inline-size-check.ts'
import { createLazyLoadingCheck } from './checks/performance/lazy-loading-check.ts'
import { createRenderBlockingScriptCheck } from './checks/performance/render-blocking-check.ts'
import { createTotalRequestsCheck } from './checks/performance/total-requests-check.ts'

// Accessibility checks
import { createAriaLandmarksCheck } from './checks/accessibility/aria-landmarks-check.ts'
import { createFormLabelCheck } from './checks/accessibility/form-label-check.ts'
import { createLangAttributeCheck } from './checks/accessibility/lang-attribute-check.ts'
import { createLinkTextCheck } from './checks/accessibility/link-text-check.ts'
import { createTabindexCheck } from './checks/accessibility/tabindex-check.ts'

export function registerAllChecks(runner: CheckRunner, options: ResolvedChecksOptions): void {
	// SEO checks
	if (options.seo !== false) {
		const seo = options.seo
		const titleMax = seo.titleMaxLength ?? 60
		const descMax = seo.descriptionMaxLength ?? 160
		const descMin = seo.descriptionMinLength ?? 50

		runner.registerCheck(createTitleMissingCheck())
		runner.registerCheck(createTitleEmptyCheck())
		runner.registerCheck(createTitleLengthCheck(titleMax))
		runner.registerCheck(createDescriptionMissingCheck())
		runner.registerCheck(createDescriptionLengthCheck(descMin, descMax))
		runner.registerCheck(createCanonicalMissingCheck())
		runner.registerCheck(createCanonicalInvalidCheck())
		runner.registerCheck(createCanonicalMismatchCheck())
		runner.registerCheck(createJsonLdInvalidCheck())
		runner.registerCheck(createMultipleH1Check())
		runner.registerCheck(createNoH1Check())
		runner.registerCheck(createHeadingSkipCheck())
		runner.registerCheck(createOgTitleCheck())
		runner.registerCheck(createOgDescriptionCheck())
		runner.registerCheck(createOgImageCheck())
		runner.registerCheck(createImageAltMissingCheck())
		runner.registerCheck(createImageAltQualityCheck())
		runner.registerCheck(createMetaDuplicateCheck())
		runner.registerCheck(createViewportMissingCheck())
		runner.registerCheck(createNoindexDetectedCheck())
		runner.registerCheck(createTwitterCardCheck())
		runner.registerSiteCheck(createRobotsTxtCheck())
		runner.registerSiteCheck(createSitemapXmlCheck())
		runner.registerSiteCheck(createBrokenInternalLinksCheck())
	}

	// GEO checks
	if (options.geo !== false) {
		const geo = options.geo
		const minContent = geo.minContentLength ?? 300
		const minHeadings = geo.minHeadings ?? 2

		runner.registerSiteCheck(createLlmsTxtCheck())
		runner.registerCheck(createContentTooShortCheck(minContent))
		runner.registerCheck(createInsufficientHeadingsCheck(minHeadings))
	}

	// Performance checks
	if (options.performance !== false) {
		const perf = options.performance
		const maxHtml = perf.maxHtmlSize ?? 100_000
		const maxImg = perf.maxImageSize ?? 500_000
		const formats = perf.allowedImageFormats ?? ['webp', 'avif', 'svg']
		const maxInline = perf.maxInlineSize ?? 50_000
		const maxRequests = perf.maxExternalRequests ?? 20

		runner.registerCheck(createHtmlSizeCheck(maxHtml))
		runner.registerCheck(createImageFormatCheck(formats))
		runner.registerCheck(createImageSizeCheck(maxImg))
		runner.registerCheck(createLazyLoadingCheck())
		runner.registerCheck(createRenderBlockingScriptCheck())
		runner.registerCheck(createInlineSizeCheck(maxInline))
		runner.registerCheck(createTotalRequestsCheck(maxRequests))
	}

	// Accessibility checks
	if (options.accessibility !== false) {
		runner.registerCheck(createLangAttributeCheck())
		runner.registerCheck(createFormLabelCheck())
		runner.registerCheck(createAriaLandmarksCheck())
		runner.registerCheck(createLinkTextCheck())
		runner.registerCheck(createTabindexCheck())
	}
}
