# @nuasite/components

Reusable [Astro](https://astro.build/) components optimized for sites connected to
[Nua Site](https://www.nuasite.com). The package currently ships:

- `Form`: Progressive enhancement for Nua Site form submissions with friendly UI states.
- `Image`: Ergonomic Cloudflare Image Transform helper that builds `/cdn-cgi/image/<options>/<src>` URLs and responsive `srcset`.

## Install

```bash
bun add @nuasite/components
```

The package targets Astro projects and expects `typescript@^5` to be available
in your workspace (peer dependency).

## Usage

### Form

```astro
---
import { Form } from '@nuasite/components'
---

<Form
  action="/contact"
  successMessage="Thanks—we'll be in touch!"
  submittingMessage="Sending..."
  errorMessage="Something went wrong."
/>
```

Pass either a `formId` issued by Nua Site, or a custom `action` URL. You
can override the default success, error, submitting, and retry copy via props.

### Responsive image (Cloudflare)

```astro
---
import { Image } from '@nuasite/components'
---

<Image
  src="https://cdn.nuasite.com/assets/www-mangoweb-cz/vakovako-3.webp"
  alt="Abstract architectural pattern with curved windows."
  widths={[480, 768, 1024, 1400, 1920]}
  sizes="(min-width: 1024px) 60vw, 100vw"
  transformOptions={{ fit: 'cover', dpr: 1.5 }}
/>
```

Key props:

- `widths`: Breakpoints used to build `srcset` (defaults provided).
- `sizes`: `sizes` attribute string; controls browser selection.
- `transformOptions`: Cloudflare transform params (quality, fit, dpr, format, etc.).
- `deliveryBase`: Override `/cdn-cgi/image` if you proxy through another path or domain.
- `allowedDomains`: Whitelist of hostnames that should be transformed. Leave empty to allow all; when set, non-matching hosts fall back to the original `src` with no transform.

Absolute `src` values keep their origin and prepend the transform path, e.g.
`https://cdn.nuasite.com/cdn-cgi/image/.../assets/file.webp`.

## Types

TypeScript projects can import the component props to help with strongly typed
helper utilities:

```ts
import type { FormProps } from '@nuasite/components'

const defaults: FormProps = {
	formId: 'contact',
	successMessage: 'Success!',
}
```

`FormProps` ensures at least one of `formId` or `action` is provided at compile
time, catching configuration mistakes early.

## Local development

If you need to work on the components themselves:

```bash
cd packages/components
bun install
bunx tsx src/index.ts
```

During local testing you can import components directly via workspace links in
your Astro project to iterate quickly.
