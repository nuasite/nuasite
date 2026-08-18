# @nuasite/cms-client

Headless TypeScript SDK for the Nua CMS. Zero React/DOM-framework coupling — a typed
`fetch` client over the cms-sidecar `/cms/v1` HTTP contract, plus the pieces every
collections UI has to get right the same way: the entry-draft form model, the
save/conflict token dance, whole-collection loading, media preview resolution and
the slug rule the server writes by.

Build any collections UI on top of it:

```ts
import {
	createClient,
	draftFromEntry,
	setDraftField,
} from '@nuasite/cms-client'

const client = createClient('/app/project/acme/session/123/cms') // host adds /cms/v1
const collections = await client.getCollections()
const entry = await client.getEntry('posts', 'hello-world')
```

## What's here

- **`createClient(apiBase)`** → `CmsClient`: `getProject`/`getCollections`/`getEntries`/`getEntry`
  plus mutations (`updateEntry` with `409` conflict result, `createEntry`, `deleteEntry`,
  `renameEntry`, array item ops) and media (`listMedia`/`uploadMedia`/`deleteMedia`,
  degrades to `501` when the sidecar has no adapter — see `isMediaUnavailable`).
- **`CmsClientError`** — carries the sidecar error `code` (`unauthorized`/`forbidden`/`not_found`/…).
- **Form model** — `draftFromEntry`, `draftForCreate`, `draftFromServerFrontmatter`,
  `setDraftField`, `coerceInput`, `parseWireValue`, and `valueTo*` readers. Pure,
  unit-testable wire ↔ native mapping for the entry editor.
- **`createEntrySaver(client, collection, slug)`** — holds the `baseHash` optimistic-concurrency
  token and runs the `409` protocol (`save`, `overwrite`, `adoptServer`). _When_ to save — a
  debounce, a Save button — stays with the UI; the token handling does not.
- **`loadAllEntries(client, collection, fields, cap?)`** — exhausts the cursor for a host that
  sorts, searches or counts across the whole collection, reporting `truncated` when a `cap` cut it short.
- **`mediaPreviewSrc` / `looksLikeImage`** — which origin an `image`/`file` value loads from
  (CDN, `data:`, a repository path via the sidecar, an Astro `image()` path against its entry).
- **`slugify` / `nextFreeSlug`** — re-exported from `@nuasite/cms-types`. A host deriving a slug
  is predicting the sidecar's write, so both sides run the same function.

The structural contract (collections/fields/entries/media) is re-used 1:1 from
[`@nuasite/cms-types`](../cms-types). The default React UI built on this SDK is
[`@nuasite/collections-admin`](../collections-admin).
