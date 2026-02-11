---
title: Introducing Inline Visual Editing
author: Nua Team
date: 2025-11-15
tags:
  - cms
  - release
excerpt: Click any element on the page, edit it in place, and save — no separate admin panel required.
coverImage: https://images.unsplash.com/photo-1542744094-3a31f272c490?w=1200&h=630&fit=crop
draft: false
---

The CMS integration now supports inline visual editing. Every rendered HTML element gets a `data-cms-id` attribute during build, making it addressable by the editor overlay.

### How it works

When you run `astro dev`, the CMS injects a lightweight editor script into the page. Click any text element to open an inline editor. Changes are written back to the source `.astro` or `.md` file on save.

### What's editable

- Text content in any HTML element
- Image `src` and `alt` attributes
- Link `href` values
- Markdown frontmatter fields

### What's not (yet)

- Component props passed through JavaScript
- Dynamic content generated at build time from external APIs
- CSS values and class names

The editor uses a block-based panel that appears at cursor position. Each editable property gets its own field with the appropriate input type — text, textarea, URL, or image upload.

### Try it

Run the playground in dev mode and click any heading on this page. The editor should appear immediately.
