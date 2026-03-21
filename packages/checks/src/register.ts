import type { CheckRunner } from './check-runner'
import type { ResolvedChecksOptions } from './types'

// SEO checks
import { createBrokenInternalLinksCheck } from './checks/seo/broken-internal-links-check'
import { createCanonicalInvalidCheck, createCanonicalMismatchCheck, createCanonicalMissingCheck } from './checks/seo/canonical-check'
import { createDescriptionLengthCheck, createDescriptionMissingCheck } from './checks/seo/description-check'
import { createHeadingSkipCheck, createMultipleH1Check, createNoH1Check } from './checks/seo/heading-hierarchy-check'
import { createImageAltMissingCheck } from './checks/seo/image-alt-check'
import { createJsonLdInvalidCheck } from './checks/seo/json-ld-check'
import { createMetaDuplicateCheck } from './checks/seo/meta-duplicates-check'
import { createNoindexDetectedCheck } from './checks/seo/noindex-check'
import { createOgDescriptionCheck, createOgImageCheck, createOgTitleCheck } from './checks/seo/open-graph-check'
import { createRobotsTxtCheck, createSitemapXmlCheck } from './checks/seo/sitemap-robots-check'
import { createTitleEmptyCheck, createTitleLengthCheck, createTitleMissingCheck } from './checks/seo/title-check'
import { createTwitterCardCheck } from './checks/seo/twitter-card-check'
import { createViewportMissingCheck } from './checks/seo/viewport-check'

// GEO checks
import { createAgentsMdCheck } from './checks/geo/agents-md-check'
import { createContentTooShortCheck, createInsufficientHeadingsCheck } from './checks/geo/content-quality-check'
import { createLlmsTxtCheck } from './checks/geo/llms-txt-check'

// Performance checks
import { createHtmlSizeCheck } from './checks/performance/html-size-check'
import { createImageFormatCheck, createImageSizeCheck } from './checks/performance/image-optimization-check'
import { createInlineSizeCheck } from './checks/performance/inline-size-check'
import { createLazyLoadingCheck } from './checks/performance/lazy-loading-check'
import { createRenderBlockingScriptCheck } from './checks/performance/render-blocking-check'
import { createTotalRequestsCheck } from './checks/performance/total-requests-check'

// Accessibility checks
import { createAriaLandmarksCheck } from './checks/accessibility/aria-landmarks-check'
import { createFormLabelCheck } from './checks/accessibility/form-label-check'
import { createLangAttributeCheck } from './checks/accessibility/lang-attribute-check'
import { createLinkTextCheck } from './checks/accessibility/link-text-check'
import { createTabindexCheck } from './checks/accessibility/tabindex-check'

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
		runner.registerSiteCheck(createAgentsMdCheck())
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
