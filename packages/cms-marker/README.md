# @nuasite/cms-marker

An Astro integration that automatically marks HTML elements with unique identifiers and generates a manifest mapping content to source files and line numbers. Perfect for building CMS editors that need to track where content originates in your codebase.

## Features

- **Automatic Marking**: Adds `data-cms-id` attributes to HTML elements during build
- **Source Location Tracking**: Maps content back to exact line numbers in `.astro` source files
- **Variable Detection**: Finds content defined as variables in frontmatter
- **Nested Content Support**: Handles placeholders for nested CMS-editable elements
- **Dev & Build Modes**: Works in both development and production builds
- **Manifest Generation**: Creates JSON manifest with all CMS-editable content

## Installation

```bash
bun add -D @nuasite/cms-marker
# or: npm install -D @nuasite/cms-marker
```

## Usage

Add the integration to your `astro.config.mjs`:

```js
import cmsMarker from '@nuasite/cms-marker'
import { defineConfig } from 'astro/config'

export default defineConfig({
	integrations: [
		cmsMarker({
			// Optional configuration
			attributeName: 'data-cms-id',
			includeTags: null, // null = all tags, or specify array like ['h1', 'p', 'a']
			excludeTags: ['html', 'head', 'body', 'script', 'style'],
			includeEmptyText: false,
		}),
	],
})
```

## How It Works

### 1. HTML Marking

The integration processes your HTML and adds unique IDs:

```html
<!-- Before -->
<h1>Welcome to my site</h1>
<p>This is some content</p>

<!-- After -->
<h1 data-cms-id="cms-0">Welcome to my site</h1>
<p data-cms-id="cms-1">This is some content</p>
```

### 2. Source Location Tracking

It searches your `.astro` source files to find where content originates:

```astro
<!-- src/components/Hero.astro -->
---
const title = "Welcome to my site";
---
<h1>{title}</h1>  <!-- Line 4 -->
```

### 3. Manifest Generation

Creates a JSON manifest mapping IDs to source locations:

```json
{
	"cms-0": {
		"id": "cms-0",
		"file": "index.html",
		"tag": "h1",
		"text": "Welcome to my site",
		"sourcePath": "src/components/Hero.astro",
		"sourceLine": 4
	}
}
```

## Configuration Options

### `attributeName`

- **Type**: `string`
- **Default**: `'data-cms-id'`
- The HTML attribute name to use for marking elements.

### `includeTags`

- **Type**: `string[] | null`
- **Default**: `null`
- If `null`, all tags are included. Otherwise, only specified tags are marked.

### `excludeTags`

- **Type**: `string[]`
- **Default**: `['html', 'head', 'body', 'script', 'style']`
- Tags to exclude from marking.

### `includeEmptyText`

- **Type**: `boolean`
- **Default**: `false`
- Whether to mark elements with no text content.

## Manifest Entry Structure

Each entry in the manifest contains:

```typescript
export interface ManifestEntry {
	id: string // The CMS ID (e.g., "cms-0")
	file: string // Output HTML file (e.g., "index.html")
	tag: string // HTML tag name (e.g., "h1")
	text: string // Text content with placeholders for nested elements
	sourcePath?: string // Source .astro file path
	sourceLine?: number // Line number in source file
	sourceSnippet?: string // Source code snippet
	sourceType?: 'static' | 'variable' | 'prop' | 'computed' // Type of source
	variableName?: string // Variable name if source is a variable
	childCmsIds?: string[] // IDs of nested CMS elements
}
```

## Supported Patterns

### ✅ Static Text

```astro
<h1>Hello World</h1>
```

### ✅ Simple Variables

```astro
---
const title = "My Title";
---
<h1>{title}</h1>
```

### ✅ Variables with Type Annotations

```astro
---
const path: string = "src/pages";
---
<pre>{path}</pre>
```

### ✅ Object Properties

```astro
---
const content = {
  title: "Welcome",
  subtitle: "Get Started"
};
---
<h1>{content.title}</h1>
<h2>{content.subtitle}</h2>
```

### ✅ Nested CMS Elements

```astro
<h1>Start <span>nested</span> end</h1>
<!-- Manifest text: "Start {{cms:cms-1}} end" -->
```

### ✅ Escaped Quotes and Special Characters

```astro
---
const text = 'What\'s up';
const message = "Hello & goodbye";
---
<p>{text}</p>
<span>{message}</span>
```

### ⚠️ Partial Support

Some patterns have limited support and may not always resolve to exact source locations:

- Complex variable expressions
- Props passed from parent components
- Template literals with expressions
- Computed values

In these cases, the manifest will still include the entry but `sourceLine` may be `undefined`.

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Run tests in watch mode
bun test --watch
```

## Testing

The package includes comprehensive tests (27 tests, all passing) covering:

- HTML processing and ID assignment
- Tag inclusion/exclusion rules
- Manifest generation
- Source location finding
- Variable reference detection
- Escaped quotes and HTML entities
- Multiple identical tags disambiguation
- Edge cases and error handling

Run tests with:

```bash
bun test
```

See `src/tests/` for all test cases.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.
