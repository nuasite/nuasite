# @nuasite/nua

`@nuasite/nua` is the meta package that mirrors the toolchain Nua Site uses
during the build phase. Add it to your project to pull in the exact versions of
Astro, Tailwind CSS, and the Nua Site packages that deploy your site so local
runs behave exactly like the hosted service.

## What's included

Installing `@nuasite/nua` brings along:

- `astro` plus the Nua-specific `nua-build` wrapper (`@nuasite/build`)
- Official Astro integrations (`@astrojs/check`, `@astrojs/mdx`, `@astrojs/sitemap`)
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
- Sensible defaults: `site: 'http://localhost:4321'`, `vite.build.sourcemap: true`, `compressHTML: true` (Astro 6's whitespace handling) and the `unified()` markdown processor (see [Markdown](#markdown))

### Configuration options

Pass standard Astro config options, plus a `nua` key for integration settings:

```ts
import { defineConfig } from '@nuasite/nua/config'

export default defineConfig({
	site: 'https://example.com',
	nua: {
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
	},
})
```

### Markdown

Astro 7 renders `.md` and `.mdx` with Sätteri by default, which does not run remark or rehype plugins. The CMS's directives (`:::list{.class}`, `::youtube{#id}`) and its markdown markers are remark and rehype plugins, so `defineConfig` sets `markdown.processor` to `unified()` from `@astrojs/markdown-remark`, and the integrations add their plugins to it. MDX uses the same processor.

To add plugins of your own, pass your own `unified()`. The integrations add theirs to it:

```ts
import { unified } from '@astrojs/markdown-remark'
import { defineConfig } from '@nuasite/nua/config'

export default defineConfig({
	markdown: {
		processor: unified({ remarkPlugins: [myRemarkPlugin] }),
	},
})
```

With another processor (`satteri()`), the CMS directives do not render and markdown is not marked for editing. The dev server and build warn about it.

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

Astro's own `defineConfig` does not set nua's defaults. Set `markdown.processor: unified()` from `@astrojs/markdown-remark` for the CMS directives, and `compressHTML: true` to keep the whitespace between inline elements.

## Redirects

A site can declare redirects in three places, and the build merges them into one `dist/_redirects`:

| Source                          | Written by               | Precedence |
| ------------------------------- | ------------------------ | ---------- |
| `src/_redirects`                | editors, through the CMS | highest    |
| `public/_redirects`             | hand                     | middle     |
| `redirects` in the Astro config | code                     | lowest     |

- **One rule per path.** When two sources redirect the same path, the one with higher precedence is kept and the build logs the rule it overrode. Cloudflare Pages rejects a file that lists a path twice, together with the whole deploy.
- **Higher precedence comes first.** Each source's rules are written as a block, in their own order, ahead of the sources they override. A host applies the first rule that matches, so a CMS rule wins over code whether it is an exact path or a pattern, and the order within a hand-written file is kept. An exact rule that a pattern from higher up reaches first is logged as never reached.
- **Lines it does not read are kept as written.** A line that is not `source destination [status] [conditions]`, such as a Netlify role gate (`/admin/* 200! Role=admin`) or one with a trailing comment, stays where it was and is not merged.
- **Netlify conditions are kept apart.** Rules for one path that differ by condition (`Language=cs`) or query (`id=:id`) are different rules.
- **An untouched file stays as written.** When nothing is merged into `public/_redirects`, its copy keeps its comments and layout.

**Editors redirect; code guards.** A rule from the CMS may only redirect (301, 302, 303, 307 or 308, no conditions, so no proxying), and it may not touch a path a guard in code covers: a rule with conditions such as a role gate (`Role=admin`), a 4xx, or a line not read as a rule. Listed first, an editor's rule could otherwise take access control off a path. The build leaves such a rule out with a warning, and the CMS editor refuses to save a rule the build would not read or allow.

Paths in the config's `redirects` are root-relative, as Astro reads a key: `'old'` and `'/old'` both redirect `/old`, and a destination written without a slash gets one. Route params become the host's placeholders: `[slug]` is `:slug`, `[...rest]` is `*` (`:splat` in the destination).
