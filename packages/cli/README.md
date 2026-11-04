# @nuasite/cli

`@nuasite/cli` is the cli tool that powers [Astro](https://astro.build/) projects updated by
[Nua Site](https://www.nuasite.com). It wraps `astro build`, `astro dev`, and
`astro preview` with the Nua defaults and adds project-level commands
(`check`, `init`, `clean`, `migrate`).

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

### `nua check`

Validates the content collections without building the site:

```bash
nua check                 # exit 1 on errors
nua check --json          # machine-readable report
nua check --strict        # warnings fail too
nua check --content-only  # skip the source parse (and the live schema rules)
nua check --no-live       # skip the live schema rules only
nua check --fail-on src/styles/site.css,src/pages/index.astro
                          # report everything, fail only on errors in these files
```

Run it anywhere in the project: with no `astro.config.*` in the current directory
it checks every `packages/*` that has one, so a monorepo root works too — which is
where `bun run build` typically builds something else entirely.

It reads `src/content.config.ts`, walks every collection's entries and reports
frontmatter that does not parse, values that do not match a declared field type
(`order: ""` where the schema wants a number), missing required fields, and
`reference()` values pointing at no entry.

It then parses the project's own `.astro`, `.ts` and `.tsx` — each `.astro` through
`@astrojs/compiler` and then the emitted TypeScript, which is the same two steps a
build takes before it renders anything. That catches the syntax error that kills a
build in `Building static entrypoints`, and reports it at its line in the `.astro`
source rather than in generated code. It is a syntax check, not a type check: a
wrong prop type still needs `astro check` or a build.

Stylesheets under the project (not in `public/`, which is copied as it is) go through
Tailwind's CSS parser, because the build runs every stylesheet through it, Tailwind or
not. It refuses what a browser quietly repairs: a rule left without its closing `}`,
a stray `}`, an unterminated string, a declaration without its colon. Only those syntax
errors are reported. What only the whole project can settle, such as `@apply` of a
utility its theme defines, is left to the build. The parser is the site's own
`tailwindcss` when it has one installed, since its strictness changed between
versions, and the copy this CLI ships otherwise.

`--fail-on` is for a commit: it still reports every problem, but fails only on errors
in the files it lists (comma-separated, relative to where the command runs), so a
change cannot add a broken file while an error it did not touch does not block it.
With `--strict`, warnings in the listed files fail too. A listed source file the run
did not parse (outside every Astro project, in `public/`, or missing) is named in the
output, so a gate on it does not read as a pass.

Use it instead of a full build when you only need to know whether the content is
still valid: `astro build` validates the same things but costs the whole render
and stops at the first bad entry, while this reports every problem in one pass —
under a second on a 1500-entry site. A dangling reference is a warning, because
it builds green and then renders nothing.

#### Live schema rules

Unless you pass `--no-live` or `--content-only`, `check` also imports your
`src/content.config.ts` and validates against the **real** Zod schemas, using the
project's own `astro/zod`. That adds two things the static rules cannot give you:

- `entry/schema-rejected` — every entry the build would reject, including what a
  plain `z.string().min(3)`, a union, a coercion or a refinement says. This is the
  verdict `astro sync` gives, without the build.
- `cms/empty-write` — the writes the CMS editor is about to make, parsed before
  anyone makes them: creating a new entry in a collection, and clicking "+ Add" in
  a repeater. A required field the editor cannot fill is a schema that breaks the
  build the first time an editor touches it. Where the simulation cannot run,
  `cms/empty-write-unchecked` says so rather than passing silently. What is left
  after `newRepeaterItem` seeds the item is a required key the config does not
  declare, or one whose type has no blank the schema takes (a required enum).
- `cms/required-drift` and `cms/field-degraded` — the two places the editor's
  picture of a field and the build's picture come apart. The editor is built from
  what the config parser could read, so a field schema behind an import loses its
  `.optional()` (the editor then refuses to save it blank) and loses its type (the
  editor then renders a text input the schema will not accept). Both are proved by
  asking the schema, never by assuming the parser's silence means something.

Having the real schema also makes `entry/missing-required` stand down for that
collection: `required` is only what the parser could see, and `entry/schema-rejected`
knows what the build actually insists on.

These findings carry a `hint` — a `→` line under the finding in human output, a
`hint` field in `--json` — saying what to change. It is derived from the write
itself, not guessed from the error: a key the editor omits is fixed by
`.optional()` or `.default(…)` (and _not_ by `.nullable()`, which accepts `null`
but still wants the key), while a key the editor fills with a rejected value
cannot be, and gets the other remedy. A run of findings sharing one hint prints it
once.

Two limits are worth knowing:

- The `astro:content` stub used to import the config accepts the same shapes
  `reference()` does, but not the lookup that follows it, and `image()` accepts
  anything — a build resolves those, an import cannot. So the live schema never
  reports a dangling reference or a missing image; the static rules
  (`entry/dangling-reference`, `entry/missing-asset`) are what cover those.
- Live rules run only when the command resolves to **one** Astro project. The
  `astro:content` stub is process-global, so in a multi-root run one project's
  schemas would judge the others. Run the check inside each project to get them.

Whenever the live rules do not run, the report says why — one line in the human
output, and a `liveSchemas` field (`"ran"` or the reason) in `--json`.

`check` is new in 0.51.0. Most projects do not depend on `@nuasite/cli` directly
— it arrives through `@nuasite/nua`, which pins it exactly — so a project on an
older `@nuasite/nua` has an older `nua` and answers `Unknown command: check`
until it bumps. To run it regardless of what the project pins, and from a plain
shell where `node_modules/.bin` is not on `PATH`:

```bash
bunx @nuasite/cli@latest check
```

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
