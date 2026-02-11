---
title: Making Every Page Available as Markdown
author: Nua Team
date: 2025-12-03
tags:
  - llm
  - accessibility
excerpt: The LLM enhancements integration exposes every page as a .md endpoint, so AI assistants can read your site.
coverImage: https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&h=630&fit=crop
draft: false
---

Large language models don't parse HTML well. They need clean, structured text. The `@nuasite/llm-enhancements` integration solves this by generating a `.md` version of every page on your site.

### What gets generated

For a page at `/about/`, the integration creates `/about.md` containing the page's text content stripped of HTML tags, navigation, and boilerplate. It also generates:

- `/llms.txt` — a site-wide index of all `.md` endpoints
- `/.well-known/llm.md` — a standardized discovery endpoint

### How content is extracted

The integration processes the final rendered HTML. It strips `<nav>`, `<footer>`, `<script>`, and `<style>` elements, then converts the remaining content to markdown using heading levels, lists, and paragraph breaks.

### Configuration

By default, all pages are included. You can exclude specific paths:

```ts
llmEnhancements({
  exclude: ['/admin/**', '/api/**']
})
```

### Why this matters

AI assistants, search engines, and research tools increasingly consume web content programmatically. Providing a clean markdown endpoint means your content is accessible to these tools without scraping.
