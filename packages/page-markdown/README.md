# @nuasite/page-markdown

An Astro integration that exposes pages as `.md` endpoints. During development, any page can be accessed as markdown by appending `.md` to its URL. In production builds, corresponding `.md` files are generated alongside your HTML output.

## Features

- **Dev Server Support**: Access any page as markdown (e.g., `/about.md`)
- **Build Output**: Generates `.md` files during `astro build`
- **Content Collections**: Preserves original markdown from Astro content collections
- **HTML to Markdown**: Converts static pages to clean markdown
- **Alternate Links**: Injects `<link rel="alternate" type="text/markdown">` into HTML
- **Frontmatter**: Includes metadata like title, description, and source path

## Installation

```bash
bun add -D @nuasite/page-markdown
# or: npm install -D @nuasite/page-markdown
```

## Usage

Add the integration to your `astro.config.mjs`:

```js
import pageMarkdown from '@nuasite/page-markdown'
import { defineConfig } from 'astro/config'

export default defineConfig({
	integrations: [
		pageMarkdown({
			// Optional configuration
			contentDir: 'src/content',
			includeStaticPages: true,
			includeFrontmatter: true,
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

## HTML to Markdown Conversion

When converting static pages, the integration:

- Extracts main content from `<main>`, `<article>`, or similar containers
- Converts headings, paragraphs, lists, code blocks, tables, and links
- Excludes navigation, footer, header, scripts, and forms
- Extracts title and description from meta tags
- Cleans up excessive whitespace

### Supported Elements

| HTML | Markdown |
| --- | --- |
| `<h1>` - `<h6>` | `#` - `######` |
| `<p>` | Paragraph |
| `<strong>`, `<b>` | `**bold**` |
| `<em>`, `<i>` | `*italic*` |
| `<code>` | `` `code` `` |
| `<pre><code>` | Code blocks |
| `<a>` | `[text](url)` |
| `<img>` | `![alt](src)` |
| `<ul>`, `<ol>`, `<li>` | Lists |
| `<blockquote>` | `> quote` |
| `<table>` | Markdown tables |

## Integration with @nuasite/cms-marker

When used alongside `@nuasite/cms-marker`, the integration can access content collection data through the CMS manifest. This is optional and works without it.

```js
import cmsMarker from '@nuasite/cms-marker'
import pageMarkdown from '@nuasite/page-markdown'
import { defineConfig } from 'astro/config'

export default defineConfig({
	integrations: [
		cmsMarker(),
		pageMarkdown(),
	],
})
```

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

## License

Apache-2.0
