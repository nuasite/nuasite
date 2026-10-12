# @nuasite/cms-sidecar

Thin standalone Bun HTTP server exposing [`@nuasite/cms-core`](../cms-core) over
`/cms/v1`. It runs next to a site's dev server rather than inside it, so the CMS
version is decoupled from the site's Astro version.

```bash
bunx @nuasite/cms-sidecar serve --port 4321 --root /path/to/site [--content-dir src/content]
```

It prints `cms-sidecar listening on :<port>` once ready, and answers a `GET /health`
liveness probe with `{ ok, coreVersion, root }`.

The typed client for this contract is [`@nuasite/cms-client`](../cms-client);
the wire shapes come from [`@nuasite/cms-types`](../cms-types).

## Collections the scan cannot vouch for

`GET /cms/v1/collections` lists the collections the scan could read. The scan is a walk
of the content directory combined with a static read of the content config
(`src/content.config.ts` or `src/content/config.ts`), so a collection the site declares
can be missing from the list, or be listed with fewer entries than it has.
`GET /cms/v1/project` says which ones, in `collectionScan`, next to the `collections` of
the same scan:

```json
{
	"collections": [],
	"pages": [],
	"capabilities": { "coreVersion": "0.56.4", "features": [] },
	"collectionScan": {
		"contentConfig": "ok",
		"unresolved": [
			{
				"name": "authors",
				"reason": "unsupported-loader",
				"file": "src/data/authors.json"
			},
			{
				"name": "docs",
				"reason": "unlisted-entries",
				"base": "src/content/docs",
				"pattern": "**/*.md"
			},
			{
				"name": "news",
				"reason": "scan-failed",
				"base": "src/data/news",
				"pattern": "*.md"
			}
		]
	}
}
```

`GET /cms/v1/collections` keeps its shape: a bare array, with no place for this.

Only `GET /cms/v1/project` builds the report, and it does so on every request: concurrent
requests share one scan, but a request that comes after one has finished starts a new one.
Building it adds a listing per declared collection to that scan. The collection and entry
routes scan without it and do not pay for it.

### What is checked

The report compares the scan with what Astro 6 loads under nua's defaults. `@nuasite/nua`
sets `legacy.collectionsBackwardsCompat`, under which a declaration without a loader, and
a content directory nothing declares, are collections too. Whether a site sets the flag
cannot be read reliably, so it is taken to be set: a site without it can get a report for
something Astro does not load, and a site with it cannot have a file missed.

A collection is vouched for when every entry file it loads is an entry of some scanned
collection. Being in `collections` is not enough: a content directory of the declared name
is read whatever the loader says, and only as deep as `<slug>.<ext>` and
`<slug>/index.<ext>`. What a collection loads is taken to be:

- a `glob()` with a `base` the scan can look under and a literal `pattern` it can run: the
  files the pattern matches. A `glob()` that names no `base` loads from the project root;
- the same with a `pattern` the scan cannot run, or a list of literal patterns: any file
  under the base, since the pattern could select it;
- a declaration without a `loader`: every file under `<content dir>/<name>`, paths with a
  segment starting with `_` aside. Astro resolves the name as a URL against the content
  directory, so a name it reads as another path (`a#b`, `a?b`, `a%20b`, a backslash, a
  tab) is unknown;
- a content directory nothing declares, when the config exports `collections` and no
  declared collection is seen to have a loader: its markdown files at any depth, `_`
  paths aside. With a loader anywhere in the config, or without that export, Astro
  leaves such directories alone, and so does the report;
- anything else: unknown. That is `file()`, a custom loader, a helper call, a spread or a
  computed key among the options, a `pattern` that is not a literal (it may lead
  anywhere), a pattern with a `..` segment, and a `base` the scan cannot look under.

A pattern the scan can run is made of `*`, `**`, `?` and `{a,b}` with plain alternatives.
It cannot run a character class, an extglob, an escape, a `|` (alternation to Astro), a
`+` behind a brace (a quantifier), a brace without a comma (`{a}` is a file name to
Astro), or a brace that holds another brace, a range (`{x,1..3}`), a wildcard or an empty
alternative; nor the shapes Astro's glob reads wider than the scan does: a `..` segment,
also one a brace completes (`..{/drafts,x}`), a trailing slash, a negation behind `./`,
and a final `/**`, which to Astro also matches a file named by what stands before it.

A `base` the scan can look under is one Astro reads as the same relative directory. Astro
resolves the base as a URL against the project root, so these are not: an absolute path or
a URL; a `%`, `#` or `?`; a backslash, which becomes a slash; whitespace at either end and
a tab or line break anywhere, which are dropped; a `..` that leads out of the root, which
is resolved against it. A glob character in the base (`*`, `{`, `}`) is not one either.

Which files count as entry files: those ending in `md`, `mdx`, `json`, `yaml`, `yml` or
`toml`, which Astro's glob loads, and those ending in `mdoc`, `markdown`, `mdown`, `mkdn`,
`mkd` or `mdwn`, in any letter case, which it loads only with an integration. Counting
too many makes a report, never a miss. An image next to an entry is not an entry.

Dotfiles and files in dot directories are counted only when the pattern asks for them, as
Astro's glob keeps `*` and `**` from matching a leading dot. A pattern asks by naming the
dot at the start of a segment or of an alternative (`.well-known/*.json`). It also asks
with a `*` or a `?` at the start of an alternative, right behind a brace or behind a `|`:
Astro's glob guards a wildcard against a leading dot only at the start of the pattern and
behind a slash, so `{guide/,notes/}*.md` loads `guide/.wip.md` and `**/{*.md,*.mdx}` does
too. In a pattern the scan does not run, such a wildcard counts every dot path under the
base. And, among the patterns the scan cannot run, by a character class or an extglob,
which match a leading dot like any other character: in the last segment a dotfile
(`**/[^_]*.md` loads `guide/.wip.md`), in an earlier one a dot directory (`[^_]*/**/*.md`
loads `.cache/a.md`). `**/[^_]*.md` does not load `.obsidian/note.md`, and that file is
not counted. `_` files are counted for a glob loader: Astro loads them when the pattern
matches, and the scan skips them.

Symbolic links are followed, as Astro follows them: a linked file counts under the
link's own path, and a linked directory is walked as often as a path leads into it. The
scan itself leaves a linked directory, and a linked file under a glob base, out, so those
are reported. A link back into a directory already entered through a link on the same
path is entered once. A linked directory whose real path is outside the project root is
not walked: the collection it is in is reported as `scan-failed` at once, so a link to `/`
in a checkout does not have the sidecar list the host's files.

The listing for one collection reads at most 20,000 directories behind symbolic links.
Past that the collection is reported as `scan-failed` instead of being checked in part. A
link into a very large tree, or links that lead into each other, end there. Directories
reached without a link do not count: the tree itself is as large as it is.

### `unresolved`

Each item has a `name` and a `reason` from the set below; later versions may add reasons,
and a reason a consumer does not know means the collection is not vouched for. The reason says what the scan
knows, not whether the collection is in `collections`; look the name up to find out.

- `unsupported-loader`: what the collection loads is unknown, or its pattern cannot be
  run and a file under its `base` is not an entry of the scan.
- `scan-failed`: reading the collection, or looking where its loader loads from, threw.
  One markdown entry whose frontmatter is not valid YAML is enough, and so are a
  directory that cannot be read and one with too many directories behind its links to list.
- `unlisted-entries`: files the collection is known to load are not entries of the scan.
  They could not be read or parsed, or the scan does not take them for entries: a format
  other than md, mdx, json or yaml, a `_` path, a file nested deeper than a content
  directory is read, a data file next to markdown ones, a file behind a symbolic link.

`base`, `pattern` and `file` are what is statically known about where the files are, as
project-root-relative paths: the glob loader's literal `base` (`.` when it names none)
and `pattern`, the literal path of a `file()` loader, or the content directory the scan
read. Any of them may be absent.

A collection that loads no entry files is an empty collection, not an unresolved one. It
is in neither list, as before.

A content directory whose read threw is listed as `scan-failed` whether or not the config
declares it and whatever loaders the config has. The scan lists such a directory as a
collection whenever it can read it, so an answer without it has lost something it would
have had.

### `contentConfig`

The reader looks at `src/content.config.ts` and `src/content/config.ts`. Astro takes a
content config from `content.config.{mjs,js,mts,ts}` in the source directory, and with
the flag above from `content/config.*` there.

- `ok`: the config was read and every key of its `collections` export is known.
- `missing`: no content config was found. None of Astro's names exists under `src`, and
  none under the directory the Astro config's `srcDir` names, where it names one. Astro
  loads no collections without a content config, so the scan cannot have left any out,
  whatever content directories it lists.
- `unreadable`: a content config exists, or may exist, and none of it was read. It does
  not parse, it is a `.js`, `.mjs` or `.mts` file, or it is under a `srcDir` other than
  `src`. The same is said when where Astro loads content from cannot be told: the `srcDir`,
  or the `root` every loader's `base` is resolved against. What is declared is unknown.
- `partial`: the config was read, but not all of what it declares is known. The
  `collections` export is not an object literal (built by a call, re-exported from another
  module, a `let`), the literal has a spread, a method, a `__proto__` or a computed key
  that is not a string in it, the file mentions `collections` in a way that may add to it
  (`Object.assign(collections, …)`, and any other mention the list below does not name),
  the file imports a content config (which may be itself, and then it can change what it
  exports without naming it), or the project has two content config files and the one that
  was read need not be the one Astro uses. `unresolved` covers the names that could be
  read; others may exist.

`srcDir` and `root` are read off the code of the Astro config file Astro uses (the first
of `astro.config.mjs`, `.js`, `.ts`, `.mts`). `srcDir` is where the content config and the
content directory are; `root` is what every loader's `base` is resolved against, and the
scan takes it to be the project root. Which mention of either name is Astro's option
cannot be told without running the file: it may name another plugin's option, a variable,
a member. So every mention in the code has to be a property given a plain string, with the
string as the whole value. A mention is the name as an identifier, or a string that is
exactly the name, anywhere in the code: a string can be made a key in more ways than can
be listed (`Object.defineProperty(config, 'srcDir', …)`, `const KEY = 'root'`). All
`srcDir`s have to name the same directory inside the project, and every `root` has to be
`'.'` or `'./'`. Anything else gives `unreadable`: a value that is not a plain string (a
template with a hole, a concatenation, a call, a variable), a shorthand, a variable, a
parameter or a member of that name, a second `srcDir` that disagrees, a path that is
absolute or starts with `..`, and a file that does not parse. Comments are not code and
set nothing. Either name given an object literal is another option of that name (Astro's
are strings) and is passed over. A directory named by `srcDir` with no content config in
it settles nothing, and `src` is then judged as usual.

`as`, `satisfies`, a numeric or quoted key and a `const` of the same file are read
through, but a `const` only when the file leaves no doubt that it still holds what it was
declared as. A module-level `const` is followed when every mention of its name in the
file is one of these:

- its one declaration;
- the value of a property in an object literal the reader reads, the first argument of
  `glob`, `file`, `defineCollection` or `defineCmsCollection` where the reader reads that
  call, or the whole initializer of another `const` (an alias). The reader reads the
  initializer of a `const` that is itself followed, so a name is dropped together with
  the one that holds it;
- `X.key`, where the declaration gives `key` a string, a number, a boolean or `null`, read
  into a declaration, a property, a call argument, an array, a template, or a binary,
  logical or conditional expression;
- `export { X }`, `export default X`, a type (`typeof X`) and `Object.keys(X)`.

Any other mention drops the name. A call that takes it (`console.log(blog)`,
`Object.freeze(blog)`, `Object.values(collections)`), a member written, called or read
(`blog.loader = …`, `OPTIONS.move()`, `blog.type`), an array, a spread, a loop, a
conditional, a function that mentions it, and a second declaration of the name anywhere
in the file, a parameter or a local included: which of two declarations a mention means
is not worked out. `eval` or `Function` anywhere in the file drops every name. A
`glob`, `file`, `defineCollection` or `defineCmsCollection` that the file declares itself
is not taken for Astro's, and what is handed to it is dropped. The list names what is
harmless and not what is harmful, so a use nobody thought of leaves a name unknown and
not trusted.

A `const` that holds a string, a number, a boolean or `null` is followed whatever
mentions it: neither the binding nor the value can change.

A collection behind a name that is not followed is `unsupported-loader`; `collections`
itself behind one is `partial`.

An object literal is read only as far as its own keys settle what it holds. A key given
twice holds what it was given last. A declaration or a set of `glob` options with a `this`
anywhere in it is not read: an accessor or a method can change the literal it sits in
without naming it. A getter, a setter or a method for `loader`, `base`
or `pattern`, a `__proto__`, and a spread or a computed key after the `loader` (anywhere
among the options of `glob`) leave that part unknown.

### How to read it

- **No `collectionScan`** means unknown: the sidecar predates the field, or could not
  build the report. Nothing is known about what it left out. This is not the same as an
  empty list, and a consumer that needs the answer must not take it for one.
- **`unresolved: []` with `contentConfig` `ok` or `missing`** is the all-clear: as far as
  the limits below allow, every entry file Astro loads into a collection is an entry of
  some scanned collection. `missing` is one because Astro loads nothing without a
  content config. A site with no collections is an ordinary site. A consumer that wants to
  be careful about the first limit below may take `missing` for an all-clear only when the
  site also has no content directory: a site with content and no content config is where a
  moved `srcDir` that the reader could not see would show.
- **`unreadable` or `partial`** means collections may exist that `unresolved` cannot name.
- **A `contentConfig` or `reason` value the consumer does not know** means not vouched for.
  Later versions may add values; only `ok` and `missing` are an all-clear.

### What an all-clear still does not prove

- That `srcDir` and `root` are what the Astro config file's code says. One set where the
  names do not stand is not seen, and the report then speaks about `src` under the project
  root: an imported options object that is spread in, a wrapper around `defineConfig`, a key
  put together from parts (`['src' + 'Dir']`, `JSON.parse('{"srcDir":"./app"}')`), and an
  integration from another module that moves either through `updateConfig`.
- That Astro is run on that config file from that directory. `astro --config <file>` and
  `astro --root <dir>` move both, and the sidecar cannot know how Astro is started.
- That nothing changed a value from outside the file: another module that imports what
  the config exports, or code the config imports that reaches it some other way.
- That `glob`, `file`, `defineCollection` and `defineCmsCollection` are Astro's and nua's.
  A call is recognised by its name. One the file declares itself is not trusted, but one
  imported under that name from another module is; an alias (`import { glob as g }`) is an
  unknown loader.
- That the scan runs every pattern it takes for runnable exactly as Astro does. The two
  were compared on generated patterns, which is evidence and not a proof.
- That no integration adds an entry type of its own beyond the extensions above.
- That the entries themselves are complete or valid. The check is about which files are
  entries.

Some reports are stricter than Astro:

- A pattern the scan cannot run is reported whenever a file under its `base` is not
  listed, also when the pattern would have left that file out. `**/[^_]*.md` next to a
  `_draft.md` the scan did not list is the usual case.
- A collection whose loader is unknown is reported also when a content directory of its
  name was read and holds all of its files.
- On a site that does not set `legacy.collectionsBackwardsCompat`, a declaration without a
  loader and a content directory nothing declares are checked although Astro loads
  neither.
- Files Astro's glob skips for want of an entry type (`.markdown`, `.MD`) are counted.
- A flat file and an `index` file that share a slug (`a.md`, `a/index.md`) are two files
  here and one entry to Astro.
- An empty YAML or JSON data file, and a file nobody can read, are source files that are
  not entries.
- A linked directory reached by two links is walked twice here.
- A healthy config that mentions a collection, a loader or an options object in any way
  the list above does not name: `console.log(blog)`, `Object.freeze(OPTIONS)`,
  `Object.values(collections)`, `blog.type`, `[blog, docs].forEach(…)`, a function
  parameter that happens to share the name.
- An Astro config with a variable, a parameter or a member named `root`, or another
  plugin's option of that name given a string (`vite: { root: … }`), is `unreadable`.
- A pattern with a class or an extglob counts dot paths below the base that the pattern
  would not reach (`[^_]*.md` next to `guide/.wip.md`), and so does a pattern the scan does
  not run with a wildcard at the start of an alternative (`**/{*.md,*.mdx}` next to
  `.obsidian/note.md`).
- An Astro config with the string `'root'` or `'srcDir'` anywhere in its code, also where it
  is no key (`label: 'root'`), is `unreadable`.
- A declaration or a set of `glob` options with a `this` in it, also one that changes nothing.
- A content config that imports a file named `content.config` or `content/config` from
  anywhere is `partial`.

## Media storage

The media routes need an adapter, selected by `CMS_MEDIA_ADAPTER`
(`contember` | `s3` | `local` | `none`) — see `src/media-from-env.ts` for the
per-adapter environment variables. Without one, every `/media` route answers
`501 unsupported`.

### `GET /cms/v1/media`

| Query                  | Meaning                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `limit`                | Page size, default 50, capped at 1000.                     |
| `cursor`               | Opaque continuation token from the previous page.          |
| `folder`               | List this subfolder instead of the media root.             |
| `includeProjectImages` | Merge the project image scan into the listing (see below). |

By default the response is the storage adapter's own listing:
`{ items, folders, hasMore, cursor? }`.

### `?includeProjectImages`

Sites accumulate images that were never uploaded through the CMS — an agent commits
them under `public/` or `src/`. This flag merges a scan of those directories into
the listing, so the media picker offers everything the site actually has.

- Accepted spellings: the bare flag, `=true`, `=1`. `=false` / `=0` turn it off.
  Anything else is a `400` — a silently ignored `=TRUE` would drop the scan without
  a word.
- Root only: it is refused together with `?folder=`, because the scan has no folder
  structure.
- The adapter's uploads directory is excluded from the scan (derived from
  `MediaStorageAdapter.staticFiles.dir`), so an upload is never listed twice.
- The two sources are paginated in phases, never interleaved: the adapter is drained
  first, then the scan tops each page up. Following `cursor` yields every item exactly
  once, in the scan's stable order (filename, then URL).
- `folders` comes from the adapter and is carried through the cursor, so it stays
  populated on every page.
- The cursor is self-identifying: following it without the flag is a `400` rather
  than an empty page.
- Cost: the scan is unpaginated by nature, so it re-walks `public/` and `src/` on
  every page that reaches the scan phase.

Advertised to clients as the `media.project-images` capability in
`GET /cms/v1/project`.
