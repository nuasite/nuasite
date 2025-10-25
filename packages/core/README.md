# @nuasite/core

`@nuasite/core` is the dependency manifest that keeps Nua Site projects in sync
with the toolchain used by the hosted platform. It pins the versions of the
Astro integrations our builders expect so your local project matches the
environment that deploys it.

## Included tooling

Installing `@nuasite/core` adds the following peer dependencies to your project:

- `@astrojs/check` – type-aware diagnostics for Astro/TypeScript.
- `@astrojs/mdx` – Markdown+JSX content authoring with shared layouts.
- `@astrojs/rss` – RSS feed generation for blog-style sites.
- `@astrojs/sitemap` – sitemap generation aligned with Nua Site routing.

Keeping these packages aligned with `@nuasite/core` avoids version drift between
local dev, CI, and the Nua Site build service.

## Installation

```bash
bun add -d @nuasite/core
```

The package only ships metadata, so there is nothing to import at runtime.
Include it in `devDependencies` (or `dependencies` if you prefer) and run
`bun install`. Bun/npm/pnpm will ensure the required peer dependencies are
present—if you are missing one it will tell you exactly what to add.

When combined with `@nuasite/nua` or `@nuasite/build`, this gives you the same
stack that powers sites maintained through [Nua Site](https://www.nuasite.com).

## Updating

To pick up the latest integration versions that Nua Site supports, bump the
package and reinstall:

```bash
bun up @nuasite/core
```

Because the package is just a manifest, updates are fast and low risk—your site
continues to control its own Astro config while inheriting the vetted baseline.
