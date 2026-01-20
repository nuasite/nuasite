# @nuasite/nua

`@nuasite/nua` is the meta package that mirrors the toolchain Nua Site uses
during the build phase. Add it to your project to pull in the exact versions of
Astro, Tailwind CSS, and the Nua Site packages that deploy your site so local
runs behave exactly like the hosted service.

## What's included

Installing `@nuasite/nua` brings along:

- `astro` plus the Nua-specific `nua-build` wrapper (`@nuasite/build`)
- Official Astro integrations (`@astrojs/check`, `@astrojs/mdx`, `@astrojs/rss`,
  `@astrojs/sitemap`)
- Tailwind CSS 4 + Flowbite, wired through `@tailwindcss/vite`
- Shared UI primitives from `@nuasite/components`
- The baseline dependency manifest from `@nuasite/core`

## Install

```bash
bun add -d @nuasite/nua
```

This ensures every developer machine and CI job installs the same stack that
Nua Site uses when publishing your project. After installing, run your normal
build command (for example `bunx nua-build` or `bun run build`) and the exact
same toolchain will execute locally.

## Usage

Use the nua config wrapper for the simplest setup:

```ts
// astro.config.ts
import { defineConfig } from '@nuasite/nua/config'

export default defineConfig()
```

This single line gives you:

- Tailwind CSS 4 via `@tailwindcss/vite`
- MDX support via `@astrojs/mdx`
- Sitemap generation via `@astrojs/sitemap`
- CMS markers via `@nuasite/cms-marker`
- Page markdown output via `@nuasite/llm-enhancements`
- Sensible defaults: `site: 'http://localhost:4321'`, `vite.build.sourcemap: true`

### Configuration options

Pass standard Astro config options, plus a `nua` key for integration settings:

```ts
import { defineConfig } from '@nuasite/nua/config'

export default defineConfig({
	site: 'https://example.com',
	nua: {
		tailwindcss: true, // Enable/disable Tailwind CSS (default: true)
		mdx: true, // Enable/disable MDX support (default: true)
		sitemap: true, // Enable/disable sitemap generation (default: true)
		cmsMarker: true, // Enable/disable CMS markers (default: true)
		pageMarkdown: true, // Enable/disable page markdown output (default: true)
	},
})
```

Pass `false` to disable a feature, or pass an options object to customize it:

```ts
import { defineConfig } from '@nuasite/nua/config'

export default defineConfig({
	nua: {
		sitemap: { filter: (page) => !page.includes('/draft/') },
		mdx: { remarkPlugins: [myRemarkPlugin] },
	},
})
```

### Using the integration directly

If you prefer more control, import the integration separately:

```ts
// astro.config.ts
import nua from '@nuasite/nua/integration'
import { defineConfig } from 'astro/config'

export default defineConfig({
	integrations: [nua()],
})
```
