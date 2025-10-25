# Nua Site playground

This is a tiny Astro project that uses `@nuasite/nua` so we can verify package
changes in a realistic environment before publishing. It is not shipped to npm;
use it as a manual testing ground when iterating on the packages in this repo.

## Install

From the repository root (recommended):

```bash
bun install
```

This installs the workspace dependencies, including this playground. To update
only the playground you can run the same command inside `packages/playground`.

## Commands

All scripts are defined in `packages/playground/package.json` and can be run via
the root workspace using Bun:

```bash
bun workspace playground run dev     # astro dev
bun workspace playground run build   # astro build
bun workspace playground run preview # astro preview
```

You can also run `bunx astro ...` from the playground directory if you prefer.

## Linking local packages

While developing other packages (for example `@nuasite/components`) you can
point this playground at your local changes because Bun workspaces automatically
symlink them. Just import from the package name as usual:

```astro
---
import { Form } from '@nuasite/components'
---

<Form formId="contact" />
```

Running `bun workspace playground run dev` will now exercise your local code.

## Troubleshooting

- Run `bun run clean` from the repo root to wipe `node_modules` and `dist/`.
- If the dev server does not pick up changes, restart `bun workspace playground run dev`.
- When dependencies look stale, try `bun install --force`.
