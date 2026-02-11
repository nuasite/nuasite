---
title: CMS Editor Overlay
client: "@nuasite/cms"
date: 2025-09-01
tags:
  - cms
  - editor
  - astro
coverImage: https://images.unsplash.com/photo-1542744094-3a31f272c490?w=1200&h=630&fit=crop
url: null
featured: true
---

The inline editor overlay that powers visual editing in Nua. Click any element on the page during development to open a block editor panel with fields for text, images, URLs, and markdown frontmatter.

### Key features

- Block-based editing panel positioned at click cursor
- Automatic field type detection from HTML element type
- Live preview of changes before saving
- Undo/redo support with keyboard shortcuts
- Color swatch picker for outline toolbar

### Technical details

The editor is injected as a Vite plugin during dev mode. It processes the rendered HTML to find elements with `data-cms-id` attributes and makes them interactive. Changes are persisted by writing back to the source files through the CMS API endpoints.
