---
title: Collection Schema Inference from Frontmatter
author: Nua Team
date: 2026-01-20
tags:
  - cms
  - collections
excerpt: The CMS now infers field types from your markdown frontmatter — no manual schema configuration needed.
coverImage: https://images.unsplash.com/photo-1484417894907-623942c8ee29?w=1200&h=630&fit=crop
draft: true
---

Defining collection schemas by hand is tedious. You already have the data in your frontmatter — the CMS should figure out the types from what's there.

### How inference works

The scanner reads all `.md` and `.mdx` files in a collection directory. For each frontmatter field, it examines values across all entries to determine the type:

- Strings that look like URLs → `url` field type
- Strings that look like dates → `date` field type
- Arrays of objects → `array` with inferred object schema
- Boolean values → `boolean` toggle
- Numbers → `number` input

Fields that appear in some entries but not others are marked as optional. Fields that contain `null` are marked as nullable.

### The manifest

Inferred schemas are written to `cms-manifest.json` at build time. The editor reads this manifest to render the correct input types in the editing panel.

### Overriding inference

If the scanner gets a type wrong, you can always define the schema explicitly in `config.ts` using Astro's `defineCollection` API. Explicit schemas take priority over inferred ones.

### Status

This feature is still in development. The current implementation handles common patterns well but may misidentify edge cases like strings that happen to contain only digits.
