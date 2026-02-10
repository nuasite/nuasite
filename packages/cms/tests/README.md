# CMS Marker Test Suite

This directory contains tests for the `cms-marker` package using Bun's built-in test framework.

## Quick Start

```bash
# Run all cms-marker tests
bun test packages/cms-marker

# Run specific test file
bun test packages/cms-marker/tests/cases/html-processor.test.ts

# Run tests with pattern matching
bun test packages/cms-marker --test-name-pattern "should mark"

# Run source-finder tests only
bun test packages/cms-marker/tests/cases/source-finder/
```

## Directory Structure

```
tests/
├── cases/                     # Test files organized by feature
│   ├── source-finder/         # Source finder tests (split for maintainability)
│   │   ├── text-finding.test.ts
│   │   ├── props-and-snippets.test.ts
│   │   ├── image-finding.test.ts
│   │   ├── arrays-and-objects.test.ts
│   │   ├── edge-cases.test.ts
│   │   ├── external-imports.test.ts
│   │   └── multi-element.test.ts
│   ├── component-detection.test.ts
│   ├── html-processor.test.ts
│   ├── manifest-writer.test.ts
│   └── ...
├── utils/                     # Test utilities
│   ├── index.ts               # Barrel file - import from here
│   ├── assertions.ts          # Custom assertion helpers
│   ├── cache-helper.ts        # Cache management for isolation
│   ├── html-builders.ts       # HTML fixture builders
│   ├── id-generator.ts        # Deterministic ID generation
│   ├── mocks.ts               # Mock factories
│   ├── options.ts             # ProcessHtml options
│   ├── temp-directory.ts      # Integration test setup
│   ├── test-context.ts        # Test suite context
│   └── test-data.ts           # Test data factories
└── utils.ts                   # Legacy re-export (use utils/index.ts)
```

## Test Patterns

### Unit Tests (HTML Processing)

Use `cmsDescribe` for unit tests that process HTML:

```typescript
import { expect, test } from 'bun:test'
import { cmsDescribe, expectEntry, expectMarked, html } from '../utils'

cmsDescribe('Feature Name', { generateManifest: true }, (ctx) => {
	test('should mark heading elements', async () => {
		const result = await ctx.process(html.heading(1, 'Hello'))

		expectMarked(result, 'h1', 'cms-0')
		expectEntry(result, 'cms-0', { tag: 'h1', text: 'Hello' })
	})
})
```

### Integration Tests (File System)

Use `withTempDir` for tests that need file system access:

```typescript
import { expect, test } from 'bun:test'
import { findSourceLocation } from '../../src/source-finder'
import { setupAstroProjectStructure, withTempDir } from '../utils'

withTempDir('Source Finder', (getCtx) => {
	test('should find text in component', async () => {
		const ctx = getCtx()
		await setupAstroProjectStructure(ctx)

		await ctx.writeFile(
			'src/components/Test.astro',
			`---
---
<h1>Hello World</h1>
`,
		)

		const result = await findSourceLocation('Hello World', 'h1')

		expect(result?.file).toBe('src/components/Test.astro')
		expect(result?.line).toBe(3)
	})
}, { setupAstro: true }) // Automatically creates src/components, src/pages, src/layouts
```

### Snapshot Tests

Use Bun's snapshot testing for output validation:

```typescript
import { expect, test } from 'bun:test'
import { cmsDescribe } from '../utils'

cmsDescribe('HTML Output', { generateManifest: true }, (ctx) => {
	test('should produce expected HTML', async () => {
		const result = await ctx.process('<h1>Title</h1>')

		expect(result.html).toMatchSnapshot()
		expect(result.entries).toMatchSnapshot()
	})
})
```

## Test Utilities

### Assertions

```typescript
import {
	countMarkedElements, // Count marked elements
	expectAllMarked, // Assert multiple tags are marked
	// Components
	expectComponentCount,
	// Manifest entries
	expectEntry, // Assert entry exists with properties
	expectEntryCount, // Assert number of entries
	// Element marking
	expectMarked, // Assert element has CMS ID
	expectNoComponents,
	expectNoEntries, // Assert no entries
	expectNotMarked, // Assert element lacks CMS ID
	expectNotStyled,
	expectRejects,
	// Styles
	expectStyled,
	// Errors
	expectThrows,
	getEntryByTag, // Get entry by tag name
} from '../utils'
```

### HTML Builders

```typescript
import { html } from '../utils'

// Simple elements
html.tag('div', 'content') // <div>content</div>
html.span('text') // <span>text</span>
html.p('paragraph') // <p>paragraph</p>
html.heading(1, 'title') // <h1>title</h1>
html.button('Click me') // <button>Click me</button>

// With Astro source attributes (for dev mode testing)
html.withSource('src/components/Header.astro', '<h1>Title</h1>')
html.component('Header', '<h1>Title</h1>', 'src/components/Header.astro')
```

### Mock Factories

```typescript
import {
  createMockManifestWriter,
  createMockViteContext,
  createMockComponentDefinition,
  emptyManifest,
} from '../utils'

// Create mock ManifestWriter
const writer = createMockManifestWriter({
  getGlobalManifest: () => ({ entries: { 'cms-0': { ... } }, ... })
})

// Create mock Vite context
const context = createMockViteContext({
  command: 'serve',
  config: { markComponents: true }
})
```

### Test Data Factories

```typescript
import {
	createAvailableColors,
	createCollectionEntry,
	createColorClasses,
	createComponentInstance,
	createImageEntry,
	createManifestEntries,
	createManifestEntry,
	resetAllCounters,
} from '../utils'

// Create single entry
const entry = createManifestEntry({ tag: 'h1', text: 'Hello' })
// { id: 'cms-0', tag: 'h1', text: 'Hello', sourcePath: '/test.html' }

// Create multiple entries
const entries = createManifestEntries([
	{ tag: 'h1', text: 'Title' },
	{ tag: 'p', text: 'Paragraph' },
])

// Create image entry
const imgEntry = createImageEntry('/hero.jpg', 'Hero image')

// Reset counters between tests (done automatically by withTempDir)
resetAllCounters()
```

### Cache Management

```typescript
import {
  clearAllCaches,    // Clear all caches (source finder, ID generator, counters)
  setupCacheReset,   // Set up automatic cache clearing
  withCacheReset,    // Describe block with auto cache reset
} from '../utils'

// Option 1: Manual setup
describe('My Tests', () => {
  setupCacheReset() // Clears before each test

  test('test 1', () => { ... })
})

// Option 2: Wrapper function
withCacheReset('My Tests', () => {
  test('test 1', () => { ... })
})

// Option 3: withTempDir (recommended for integration tests)
// Automatically clears caches by default
withTempDir('My Tests', (getCtx) => {
  test('test 1', () => { ... })
})
```

### Temp Directory Options

```typescript
import { withTempDir } from '../utils'

// Default: clears caches, doesn't auto-setup Astro structure
withTempDir('Tests', (getCtx) => { ... })

// With Astro project auto-setup
withTempDir('Tests', (getCtx) => { ... }, { setupAstro: true })

// Disable cache clearing (rare)
withTempDir('Tests', (getCtx) => { ... }, { clearCaches: false })

// Custom prefix for temp directory name
withTempDir('Tests', (getCtx) => { ... }, { prefix: 'my-test-' })
```

## Writing New Tests

### 1. Choose the Right Pattern

| Scenario         | Pattern       | Utilities                                     |
| ---------------- | ------------- | --------------------------------------------- |
| HTML processing  | `cmsDescribe` | `ctx.process`, assertions                     |
| Source finding   | `withTempDir` | `setupAstroProjectStructure`, `ctx.writeFile` |
| Vite plugin      | `describe`    | `createMockViteContext`                       |
| Manifest writing | `describe`    | `createManifestEntry`, temp files             |

### 2. Use Appropriate Assertions

Prefer semantic assertions over generic `expect()`:

```typescript
// Good - semantic, clear intent
expectMarked(result, 'h1', 'cms-0')
expectEntry(result, 'cms-0', { tag: 'h1', text: 'Hello' })

// Avoid - harder to read, less specific
expect(result.html).toContain('data-cms-id="cms-0"')
expect(result.entries['cms-0'].tag).toBe('h1')
```

### 3. Ensure Test Isolation

Tests are automatically isolated when using:

- `cmsDescribe` - resets ID generator before each test
- `withTempDir` - clears caches and creates fresh temp directory

If writing custom `describe` blocks, use:

```typescript
import { setupCacheReset } from '../utils'

describe('My Tests', () => {
	setupCacheReset()
	// tests...
})
```

### 4. Keep Tests Focused

Each test should verify one behavior:

```typescript
// Good - single responsibility
test('should mark h1 elements', async () => {
	const result = await ctx.process('<h1>Title</h1>')
	expectMarked(result, 'h1')
})

test('should not mark script elements', async () => {
	const result = await ctx.process('<script>code</script>')
	expectNotMarked(result, 'script')
})

// Avoid - testing multiple unrelated things
test('should handle various elements', async () => {
	// Too many assertions, unclear what's being tested
})
```

## Running Tests

```bash
# All tests
bun test packages/cms-marker

# Watch mode
bun test packages/cms-marker --watch

# Update snapshots
bun test packages/cms-marker --update-snapshots

# Verbose output
bun test packages/cms-marker --verbose

# With timeout (useful for slow tests)
bun test packages/cms-marker --timeout 30000
```
