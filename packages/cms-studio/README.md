# @nuasite/cms-studio

The standalone, batteries-included Nua CMS. One `bunx` process serves the
collections **admin UI** and the **`/cms/v1` API** for a project, on a single
origin — no build step, no host framework, no CORS.

```bash
bunx @nuasite/cms-studio --root . --content-dir src/content
# → http://localhost:4400
```

It is the standalone composition of the headless pieces:

- [`@nuasite/cms-sidecar`](../cms-sidecar) — the `/cms/v1` HTTP API, run in-process
  over `createCmsCore(createNodeFs(root))`.
- [`@nuasite/collections-admin`](../collections-admin) — the React admin SPA,
  prebuilt into `dist/spa/` and served as static assets.

Because the UI, the API and the project's `public/` assets share one origin,
`local`-adapter media previews (`/uploads/…`) just work.

## Usage

```
cms-studio [--root <dir>] [--port <port>] [--content-dir <dir>] [--components-dir <a,b>]
```

| Flag               | Default          | Meaning                                          |
| ------------------ | ---------------- | ------------------------------------------------ |
| `--root`           | `cwd`            | Project root (the site being edited).            |
| `--port`           | `4400`           | Listen port (`PORT` env also honoured).          |
| `--content-dir`    | `src/content`    | Content collections directory, relative to root. |
| `--components-dir` | `src/components` | Comma-separated component dirs (MDX resolution). |

## Media

Media defaults to the **`local`** adapter, writing to `<root>/public/uploads`.
Point it at a hosted backend with the same env vars the sidecar reads:

```bash
CMS_MEDIA_ADAPTER=s3 CMS_MEDIA_S3_BUCKET=… CMS_MEDIA_S3_REGION=… bunx @nuasite/cms-studio --root .
```

See [`@nuasite/cms-sidecar`'s `mediaFromEnv`](../cms-sidecar/src/media-from-env.ts)
for the full set (`contember` / `s3` / `local` / `none`).

## Programmatic use

```ts
import { createServer } from '@nuasite/cms-sidecar'
import { createStudioServer } from '@nuasite/cms-studio'

const studio = createStudioServer({ sidecar, spaDir, publicDir })
Bun.serve({ port: 4400, fetch: studio.fetch })
```
