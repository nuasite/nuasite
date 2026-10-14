# @nuasite/llm-enhancements

An Astro integration that exposes pages as `.md` endpoints. During development, any page can be accessed as markdown by appending `.md` to its URL. In production builds, corresponding `.md` files are generated alongside your HTML output.

## Features

- **Dev Server Support**: Access any page as markdown (e.g., `/about.md`)
- **Build Output**: Generates `.md` files during `astro build`
- **Content Collections**: Preserves original markdown from Astro content collections
- **HTML to Markdown**: Converts static pages to clean markdown
- **Alternate Links**: Injects `<link rel="alternate" type="text/markdown">` into HTML
- **Frontmatter**: Includes metadata like title, description, and source path
- **LLM Discovery**: Auto-generated `/.well-known/llm.md` endpoint for LLM-friendly site discovery
- **llms.txt**: Auto-generated `/llms.txt` following the [llms.txt convention](https://llmstxt.org/) for crawler/LLM guidance

## Installation

```bash
bun add -D @nuasite/llm-enhancements
# or: npm install -D @nuasite/llm-enhancements
```

## Usage

Add the integration to your `astro.config.mjs`:

```js
import pageMarkdown from '@nuasite/llm-enhancements'
import { defineConfig } from 'astro/config'

export default defineConfig({
	integrations: [
		pageMarkdown({
			// Optional configuration
			contentDir: 'src/content',
			includeStaticPages: true,
			includeFrontmatter: true,
			llmEndpoint: true, // or configure with options
			llmsTxt: true, // or configure with options
		}),
	],
})
```

## How It Works

### Development Mode

When running `astro dev`, any page can be accessed as markdown by appending `.md` to its URL:

```
/about       → /about.md
/blog/hello  → /blog/hello.md
/            → /index.md
```

The dev server intercepts these requests and generates markdown on-the-fly.

### Production Build

During `astro build`, the integration processes each page and generates a corresponding `.md` file in the dist directory:

```
dist/
├── index.html
├── index.md
├── about/
│   ├── index.html
├── about.md
└── blog/
    └── hello/
        ├── index.html
    └── hello.md
```

### Content Collection Pages

For pages that come from Astro content collections, the integration reads the original markdown source and preserves it in the output:

```md
---
title: My Blog Post
description: An example post
url: /blog/hello
type: collection
source: src/content/blog/hello.md
generatedAt: 2024-01-15T10:30:00.000Z
---

# My Blog Post

This is the original markdown content from the collection...
```

### Static Pages

For static `.astro` pages, the integration converts the rendered HTML to markdown:

```md
---
title: About Us
description: Learn more about our company
url: /about
type: static
generatedAt: 2024-01-15T10:30:00.000Z
---

# About Us

Our company was founded in 2020...
```

### HTML Alternate Links

The integration automatically injects a `<link>` tag into HTML pages pointing to their markdown version:

```html
<head>
	<link rel="alternate" type="text/markdown" href="/about.md">
</head>
```

### LLM Discovery Endpoint

> **Note**: The `/.well-known/llm.md` and `/llms.txt` endpoints require a `site` to be configured in your `astro.config.mjs` to generate valid absolute URLs. If no site is configured, these endpoints will be skipped with a warning.

The integration generates a `/.well-known/llm.md` endpoint that provides LLM-friendly site discovery information:

```
http://localhost:4321/.well-known/llm.md
```

This endpoint includes:

- Site title and description (extracted from homepage metadata)
- List of all available markdown endpoints
- Usage instructions for accessing markdown versions

Example output:

```md
---
generatedAt: 2024-01-15T10:30:00.000Z
---

# My Site

Welcome to my site.

## Markdown Endpoints

This site exposes page content as markdown at `.md` URLs.

### Pages

- [https://example.com/index.md](https://example.com/index.md) - My Site
- [https://example.com/about.md](https://example.com/about.md) - About Us
- [https://example.com/blog/hello.md](https://example.com/blog/hello.md) - Hello World

## Usage

Append `.md` to any page URL to get the markdown version:

- `https://example.com/about` → `https://example.com/about.md`
- `https://example.com/blog/hello` → `https://example.com/blog/hello.md`
```

### llms.txt Endpoint

The integration also generates a `/llms.txt` file following the [llms.txt convention](https://llmstxt.org/). This provides a standardized way to communicate site structure to LLMs and crawlers:

```
http://localhost:4321/llms.txt
```

Example output:

```txt
# My Site

> Welcome to my site.

This site provides markdown versions of all pages for LLM consumption.

## LLM Discovery

- [LLM Discovery Endpoint](https://example.com/.well-known/llm.md): Full site map with all available markdown endpoints

## Markdown Endpoints

All pages are available as markdown by appending `.md` to the URL.

### Content

- [My Blog Post](https://example.com/blog/hello.md): /blog/hello

### Pages

- [My Site](https://example.com/index.md): /
- [About Us](https://example.com/about.md): /about

## Permissions

LLMs and crawlers are welcome to access markdown endpoints.
```

## Configuration Options

### `contentDir`

- **Type**: `string`
- **Default**: `'src/content'`
- Directory containing Astro content collections.

### `includeStaticPages`

- **Type**: `boolean`
- **Default**: `true`
- Whether to generate markdown for static (non-collection) pages.

### `includeFrontmatter`

- **Type**: `boolean`
- **Default**: `true`
- Whether to include YAML frontmatter in the output.

### `llmEndpoint`

- **Type**: `boolean | LlmEndpointOptions`
- **Default**: `true`
- Enable or configure the `/.well-known/llm.md` endpoint.

When set to `true`, the endpoint is enabled with default settings. You can also pass an options object:

```js
pageMarkdown({
	llmEndpoint: {
		siteName: 'My Custom Site Name',
		description: 'A custom description for my site',
		additionalContent: '## Contact\n\nReach us at hello@example.com',
	},
})
```

#### `LlmEndpointOptions`

| Option              | Type     | Description                                    |
| ------------------- | -------- | ---------------------------------------------- |
| `siteName`          | `string` | Override the site name in llm.md               |
| `description`       | `string` | Override the site description                  |
| `baseUrl`           | `string` | Override base URL (defaults to Astro's `site`) |
| `additionalContent` | `string` | Additional markdown content to append          |

Set to `false` to disable the endpoint entirely:

```js
pageMarkdown({
	llmEndpoint: false,
})
```

### `llmsTxt`

- **Type**: `boolean | LlmsTxtOptions`
- **Default**: `true`
- Enable or configure the `/llms.txt` endpoint.

When set to `true`, the endpoint is enabled with default settings. URLs are generated using the `site` value from your Astro config. You can also pass an options object:

```js
pageMarkdown({
	llmsTxt: {
		siteName: 'My Custom Site Name',
		description: 'A custom description for my site',
		baseUrl: 'https://example.com', // Override Astro's site config
		allowCrawling: true,
		instructions: 'Please be respectful of rate limits.',
		additionalContent: '## Contact\n\nReach us at hello@example.com',
	},
})
```

#### `LlmsTxtOptions`

| Option              | Type      | Description                                    |
| ------------------- | --------- | ---------------------------------------------- |
| `siteName`          | `string`  | Override the site name in llms.txt             |
| `description`       | `string`  | Override the site description                  |
| `baseUrl`           | `string`  | Override base URL (defaults to Astro's `site`) |
| `allowCrawling`     | `boolean` | Whether crawling is allowed (default: true)    |
| `instructions`      | `string`  | Custom instructions for LLMs                   |
| `additionalContent` | `string`  | Additional content to append                   |

Set to `false` to disable the endpoint entirely:

```js
pageMarkdown({
	llmsTxt: false,
})
```

## HTML to Markdown Conversion

When converting static pages, the integration:

- Extracts main content from `<main>`, `<article>`, or similar containers
- Converts headings, paragraphs, lists, code blocks, tables, and links
- Excludes navigation, footer, header, scripts, and forms
- Extracts title and description from meta tags
- Cleans up excessive whitespace

### Supported Elements

| HTML                   | Markdown        |
| ---------------------- | --------------- |
| `<h1>` - `<h6>`        | `#` - `######`  |
| `<p>`                  | Paragraph       |
| `<strong>`, `<b>`      | `**bold**`      |
| `<em>`, `<i>`          | `*italic*`      |
| `<code>`               | `` `code` ``    |
| `<pre><code>`          | Code blocks     |
| `<a>`                  | `[text](url)`   |
| `<img>`                | `![alt](src)`   |
| `<ul>`, `<ol>`, `<li>` | Lists           |
| `<blockquote>`         | `> quote`       |
| `<table>`              | Markdown tables |

## Collection pages

A page that renders a content collection entry is written from the entry's own markdown, with its source path in the frontmatter. Pages that are not backed by an entry are converted from their rendered HTML instead. The entry lookup comes from `@nuasite/cms`, an optional peer dependency (`@nuasite/nua` installs it); without it every page is converted from its HTML. The collections are scanned once per build.

A page is an entry's when it is at the URL the CMS editor shows for that entry: from the collection's `cms.pathname` rule, else a URL the entry declares in its frontmatter (`urlPath`, `permalink`, …), else the route that renders the collection plus the entry's slug. So `src/pages/aktuality/[slug].astro` rendering `news` makes `/aktuality/x` the page of `news/x.md`, while a static `/team/jana` beside `blog/jana.md` stays a static page. A route under a dynamic folder (`[lang]/blog/[slug].astro`) gives no URL, so its entries need a `cms.pathname` rule or a declared URL. Only markdown entries (`.md`, `.mdx`) are written from source; a data entry (`.json`, `.yaml`) is told by its rendered page. Entries are read from Astro's `root`, so `astro build --root site` works from any directory, and a `contentDir` may lie outside it.

An `.mdx` entry is written without its `import`/`export` blocks. It is parsed with the site's markdown syntax (directives when a remark-directive plugin is configured, as `@nuasite/nua` does). One whose body still uses a component (`<Tip>`, `<Card />`) or an expression (`{year}`) is converted from its rendered HTML instead, since those render text the source only names. It is still a collection page, so it is written even with `includeStaticPages: false`.

## Output Structure

Each markdown file includes:

```typescript
interface MarkdownOutput {
	/** YAML frontmatter fields */
	frontmatter: Record<string, unknown>
	/** Markdown body content */
	body: string
	/** Path to the original source file (if from collection) */
	sourcePath?: string
}
```

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.
