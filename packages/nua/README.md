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

Add the unified Astro integration to your `astro.config.mjs`:

```js
// astro.config.mjs
import nua from '@nuasite/nua/integration'
import { defineConfig } from 'astro/config'

export default defineConfig({
  integrations: [nua()],
})
```

This single integration enables Tailwind CSS, MDX, sitemap generation,
CMS markers, and page markdown output—all pre-configured.

### Configuration options

Each sub-integration can be disabled or customized:

```js
export default defineConfig({
  integrations: [
    nua({
      tailwindcss: true,        // Enable/disable Tailwind CSS (default: true)
      mdx: true,                // Enable/disable MDX support (default: true)
      sitemap: true,            // Enable/disable sitemap generation (default: true)
      cmsMarker: true,          // Enable/disable CMS markers (default: true)
      pageMarkdown: true,       // Enable/disable page markdown output (default: true)
    }),
  ],
})
```

Pass `false` to disable a feature, or pass an options object to customize it:

```js
nua({
  sitemap: { filter: (page) => !page.includes('/draft/') },
  mdx: { remarkPlugins: [myRemarkPlugin] },
})
```
