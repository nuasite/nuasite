# Nua Site open source packages

This repository houses the Astro-first packages that power projects maintained
via [Nua Site](https://www.nuasite.com). Each package is published to npm so
teams can reproduce the same build pipeline locally that Nua Site uses in the
hosted service.

## Packages

| Package                                                                               | Summary                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`@nuasite/nua`](/packages/nua)                                                       | Meta package that pins the versions of Astro, Tailwind CSS, Flowbite, and the Nua Site tooling used during hosted builds. |
| [`@nuasite/core`](/packages/core)                                                     | Dependency manifest that keeps official Astro integrations (`@astrojs/*`) aligned with the platform.                      |
| [`@nuasite/cli`](/packages/cli)                                                       | CLI wrapper around `astro build` that wires in the `@nuasite/agent-summary` integration and prints readable stack traces. |
| [`@nuasite/components`](/packages/components)                                         | Reusable Astro components (currently the Nua Site form widget) with TypeScript-friendly props.                            |
| [`@nuasite/agent-summary`](/packages/agent-summary)                                   | Astro integration that produces `AGENTS.md`, a machine-readable catalog of every generated page.                          |
| [`packages/playground`](https://github.com/nuasite/nua/tree/main/packages/playground) | Example Astro project used to manually test the packages in this repo.                                                    |

## Getting started

1. Install [Bun](https://bun.com) ≥ 1.0.
2. Install dependencies from the repo root:

   ```bash
   bun install
   ```

3. Run the Bun/NPM workspace scripts you need:

   - `bun run lint` / `bun run lint:fix` – Biome linting.
   - `bun run format` / `bun run format:check` – dprint formatting.
   - `bun test` – Executes the packages' Bun test suites.
   - `bun run ts:build` – Type-checks the TypeScript projects.

Use `bun workspace <package> run <command>` (or `bunx` with the binary path)
whenever a package exposes its own scripts.

## Working on a package

Each package keeps its sources in `packages/<name>/src` and may publish
generated files to `packages/<name>/dist`. The repo is managed as a single Bun
workspace, so cross-package changes can be made in one PR. A few tips:

- The playground project (`packages/playground`) can be linked against local
  packages to test them inside a real Astro site.

## Feedback & contributions

Bug fixes and improvements are welcome. If you need help or have feature
requests for the hosted service, visit [Nua Site](https://www.nuasite.com) or
open an issue in this repository so we can triage it with the team.
