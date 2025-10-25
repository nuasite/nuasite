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
