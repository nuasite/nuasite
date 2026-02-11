---
title: Content Collections
subtitle: Manage structured content with markdown and frontmatter.
heroImageDesktop: https://images.unsplash.com/photo-1484417894907-623942c8ee29?w=2560&h=653&fit=crop
heroImageMobile: https://images.unsplash.com/photo-1484417894907-623942c8ee29?w=1000&h=1500&fit=crop
stats:
  - value: "4"
    label: collections in this playground
  - value: "12"
    label: content entries total
  - value: "auto"
    label: schema inference
ctaText: >-
  Collections turn loose markdown files
  into typed, queryable content.
  The CMS makes them visually editable.
ctaLink: /cms/
---

**Manage structured content with markdown and frontmatter.**

### What's a collection

A collection is a directory of markdown files that share a common schema. Blog posts, team members, projects, services — each gets its own collection with typed frontmatter fields.

### Schema options

- Define schemas explicitly in `config.ts` using Zod validation.
- Or let the CMS infer schemas automatically from your frontmatter values.
- Explicit schemas take priority when both are present.

### CRUD via API

The CMS provides endpoints for creating, reading, updating, and deleting collection entries. The editor uses these endpoints to save changes — but they're also available for custom integrations.
