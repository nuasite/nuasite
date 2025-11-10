# @nuasite/components

Reusable [Astro](https://astro.build/) components optimized for sites connected to
[Nua Site](https://www.nuasite.com). The package currently ships a form widget
that takes care of wiring up Nua Site submissions while providing friendly UI
states you can customize.

## Install

```bash
bun add @nuasite/components
```

The package targets Astro projects and expects `typescript@^5` to be available
in your workspace (peer dependency).

## Usage

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
