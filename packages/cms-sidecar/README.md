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
