# @nuasite/checks

`@nuasite/checks` is an [Astro](https://astro.build/) integration that validates
your site for SEO, GEO (generative-engine optimization), performance, and
accessibility issues at build time. It runs after `astro build`, scans every
rendered HTML page, and reports problems before they reach production.

## Install

```bash
bun add -d @nuasite/checks
```

The package expects `typescript@^5` as a peer dependency.

## Quick start

Add the integration to your Astro config:

```ts
import checks from '@nuasite/checks'
import { defineConfig } from 'astro/config'

export default defineConfig({
	integrations: [checks()],
})
```

All check domains (SEO, GEO, performance, accessibility) are enabled by default.
The build will fail if any errors are found.

## Configuration

Pass an options object to customise behaviour:

```ts
checks({
	mode: 'essential', // 'auto' | 'full' | 'essential'
	seo: { titleMaxLength: 70 },
	geo: { minContentLength: 500 },
	performance: { maxHtmlSize: 200_000 },
	accessibility: true,
	ai: false, // AI-powered checks (requires API key)
	failOnError: true,
	failOnWarning: false,
	reportJson: true, // writes checks-report.json to dist
	overrides: {
		'seo/title-missing': 'warning', // downgrade to warning
		'seo/noindex-detected': false, // disable entirely
	},
})
```

### Disabling a domain

Set any domain to `false` to skip it entirely:

```ts
checks({ performance: false })
```

### Check modes

| Mode        | Behaviour                              |
| ----------- | -------------------------------------- |
| `auto`      | Runs `essential` locally, `full` in CI |
| `essential` | Only checks marked as essential        |
| `full`      | Runs every registered check            |

## Built-in checks

### SEO

| Check                       | Description                                                  |
| --------------------------- | ------------------------------------------------------------ |
| `seo/title-missing`         | Page has no `<title>` tag                                    |
| `seo/title-empty`           | `<title>` is empty                                           |
| `seo/title-length`          | Title exceeds max length                                     |
| `seo/description-missing`   | No meta description                                          |
| `seo/description-length`    | Description outside min/max range                            |
| `seo/canonical-missing`     | No canonical link                                            |
| `seo/canonical-invalid`     | Canonical URL is malformed                                   |
| `seo/canonical-mismatch`    | Canonical doesn't match page URL                             |
| `seo/json-ld-invalid`       | Invalid JSON-LD structured data                              |
| `seo/multiple-h1`           | More than one `<h1>` on a page                               |
| `seo/no-h1`                 | No `<h1>` on a page                                          |
| `seo/heading-skip`          | Heading levels are skipped (e.g. h2 → h4)                    |
| `seo/og-title`              | Missing Open Graph title                                     |
| `seo/og-description`        | Missing Open Graph description                               |
| `seo/og-image`              | Missing Open Graph image                                     |
| `seo/image-alt-missing`     | Image without alt attribute                                  |
| `seo/image-alt-quality`     | Alt text is generic or unhelpful                             |
| `seo/meta-duplicate`        | Duplicate meta tags                                          |
| `seo/viewport-missing`      | No viewport meta tag                                         |
| `seo/noindex-detected`      | Page has a noindex directive                                 |
| `seo/twitter-card`          | Missing Twitter Card meta tags                               |
| `seo/robots-txt`            | Missing or invalid robots.txt (site-level)                   |
| `seo/sitemap-xml`           | Missing sitemap.xml (site-level)                             |
| `seo/broken-internal-links` | Internal links that point to non-existent pages (site-level) |

### GEO

| Check                       | Description                         |
| --------------------------- | ----------------------------------- |
| `geo/content-too-short`     | Page body text below minimum length |
| `geo/insufficient-headings` | Too few headings for content length |
| `geo/llms-txt`              | Missing llms.txt file (site-level)  |

### Performance

| Check                         | Description                                 |
| ----------------------------- | ------------------------------------------- |
| `perf/html-size`              | HTML document exceeds size limit            |
| `perf/image-format`           | Images not using modern formats (WebP/AVIF) |
| `perf/image-size`             | Image files exceed size limit               |
| `perf/lazy-loading`           | Above-the-fold images missing lazy loading  |
| `perf/render-blocking-script` | Render-blocking scripts without async/defer |
| `perf/inline-size`            | Inline scripts/styles exceed size limit     |
| `perf/total-requests`         | Too many external resource requests         |

### Accessibility

| Check                 | Description                                    |
| --------------------- | ---------------------------------------------- |
| `a11y/lang-attribute` | Missing `lang` attribute on `<html>`           |
| `a11y/form-label`     | Form inputs without associated labels          |
| `a11y/aria-landmarks` | Missing ARIA landmark regions                  |
| `a11y/link-text`      | Links with non-descriptive text ("click here") |
| `a11y/tabindex`       | Positive tabindex values that break tab order  |

## Custom checks

Register your own checks alongside the built-ins:

```ts
import type { Check } from '@nuasite/checks'

const noTodoCheck: Check = {
	kind: 'page',
	id: 'custom/no-todo',
	name: 'No TODO in production',
	domain: 'seo',
	defaultSeverity: 'warning',
	description: 'Flags pages that still contain TODO markers',
	essential: false,
	run({ html }) {
		if (html.includes('TODO')) {
			return [{ message: 'Page contains a TODO marker' }]
		}
		return []
	},
}

checks({ customChecks: [noTodoCheck] })
```

## JSON report

Enable `reportJson` to write a machine-readable report to your dist directory
after every build:

```ts
checks({ reportJson: true }) // → dist/checks-report.json
checks({ reportJson: 'my-report.json' }) // → dist/my-report.json
```

## Development

```bash
cd packages/checks
bun test
```

Tests use Bun's built-in runner with `happy-dom` for DOM simulation.
