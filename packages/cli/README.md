# @nuasite/cli

`@nuasite/cli` is the cli tool that powers [Astro](https://astro.build/) projects updated by
[Nua Site](https://www.nuasite.com). It wraps `astro build`, automatically
wires up the `@nuasite/agent-summary` integration, and prints readable stack
traces when something goes wrong.

## Install

Add the package to your workspace (it is usually used as a dev dependency):

```bash
bun add -d @nuasite/cli
```

The package bundles Astro and expects `typescript@^5` to be available (peer
dependency).

## CLI usage

Once installed you get the `nua` binary:

```bash
# run directly
bunx nua build

# or wire it into package.json
{
  "scripts": {
    "build": "nua build"
  }
}
```

`nua build` runs `astro build` with the default Nua configuration (currently the
agent summary integration) and surfaces errors with inline source excerpts so
you can diagnose failures quickly.

### `nua init`

Converts a standard Astro project to use the Nua toolchain:

```bash
nua init            # interactive — previews changes, asks for confirmation
nua init --dry-run  # show what would change without writing files
nua init --yes      # skip confirmation prompt
```

This rewrites your Astro config and `package.json` to adopt `@nuasite/nua`.
Specifically it:

- Replaces `astro/config` with `@nuasite/nua/config`
- Removes Nua-managed integration imports (`@astrojs/mdx`, `@astrojs/sitemap`,
  `@tailwindcss/vite`) and their calls from the config
- Cleans up empty config structures left behind
- Removes Nua-provided dependencies and adds `@nuasite/nua`
- Updates scripts (`astro build` → `nua build`, etc.)

After running, follow the printed next-steps: `bun install`, review the
config, and run `nua dev`.

### `nua clean`

Ejects your project from the Nua toolchain back to a standard Astro setup:

```bash
nua clean            # interactive — previews changes, asks for confirmation
nua clean --dry-run  # show what would change without writing files
nua clean --yes      # skip confirmation prompt
```

This rewrites your Astro config and `package.json` so the project no longer
depends on `@nuasite/*` tooling packages. Specifically it:

- Replaces `@nuasite/nua` with explicit Astro integrations (`mdx`, `sitemap`,
  `tailwindcss`)
- Removes `@nuasite/*` tooling dependencies and adds their standard Astro
  equivalents
- Updates scripts (`nua build` → `astro build`, etc.)
- Keeps runtime packages (e.g. `@nuasite/components`) if your source files
  import them
- Respects disabled features — if a feature is set to `false` in your Nua
  config, it will be omitted from the ejected config

After running, follow the printed next-steps: `bun install`, review the
config, and remove any remaining `@nuasite` tooling imports from source files.

## Programmatic usage

You can also drive the builder yourself if you need to supply a custom inline
config:

```ts
import { agentsSummary } from '@nuasite/agent-summary'
import { build } from '@nuasite/build'

await build({
	root: new URL('../site', import.meta.url),
	integrations: [agentsSummary()],
})
```

The function accepts any `AstroInlineConfig`, so you can extend or override the
defaults that the CLI uses.

## Development

If you are iterating on `@nuasite/build` itself:

```bash
cd packages/build
bun install
bunx tsx src/cli.ts
```

This recompiles the linked Astro project with your local changes while keeping
stack traces and integration behavior intact.
