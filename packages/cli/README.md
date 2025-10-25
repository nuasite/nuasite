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

`nua-build` runs `astro build` with the default Nua configuration (currently the
agent summary integration) and surfaces errors with inline source excerpts so
you can diagnose failures quickly.

## Programmatic usage

You can also drive the builder yourself if you need to supply a custom inline
config:

```ts
import { build } from '@nuasite/build'
import { agentsSummary } from '@nuasite/agent-summary'

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
