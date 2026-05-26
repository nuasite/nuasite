# @nuasite/cli

`@nuasite/cli` is the cli tool that powers [Astro](https://astro.build/) projects updated by
[Nua Site](https://www.nuasite.com). It wraps `astro build`, `astro dev`, and
`astro preview` with the Nua defaults and adds project-level commands
(`init`, `clean`, `migrate`).

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

`nua build` proxies to `astro build` using your project's Astro config (which
should be set up via `@nuasite/nua`).

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

## Development

If you are iterating on `@nuasite/cli` itself:

```bash
cd packages/cli
bun install
bun src/index.ts build
```
