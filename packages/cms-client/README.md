# @nuasite/cms-client

Headless TypeScript SDK for the Nua CMS. Zero React/DOM-framework coupling — just
a typed `fetch` client over the cms-sidecar `/cms/v1` HTTP contract plus the pure
entry-draft form model.

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

The structural contract (collections/fields/entries/media) is re-used 1:1 from
[`@nuasite/cms-types`](../cms-types). The default React UI built on this SDK is
[`@nuasite/collections-admin`](../collections-admin).
