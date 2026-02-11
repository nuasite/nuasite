---
title: LLM Markdown Endpoints
client: "@nuasite/llm-enhancements"
date: 2025-06-15
tags:
  - llm
  - markdown
  - seo
coverImage: https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1200&h=630&fit=crop
url: null
featured: true
---

Every page on a Nua site is automatically available as a `.md` endpoint. This makes your content accessible to AI assistants, research tools, and any application that consumes structured text.

### Generated outputs

- `/page-name.md` for every rendered page
- `/llms.txt` as a site-wide content index
- `/.well-known/llm.md` for standardized discovery

### How it works

The integration hooks into Astro's build pipeline. After each page is rendered to HTML, it strips navigation, scripts, and styling, then converts the remaining content to clean markdown. The output preserves heading hierarchy, lists, links, and code blocks.
