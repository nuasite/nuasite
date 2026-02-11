---
title: Agent Summary Generator
client: "@nuasite/agent-summary"
date: 2026-01-10
tags:
  - agents
  - ai
  - documentation
coverImage: https://images.unsplash.com/photo-1484417894907-623942c8ee29?w=1200&h=630&fit=crop
url: null
featured: false
---

Automatic generation of `AGENTS.md` files containing structured metadata about every page on the site. Designed for AI coding agents that need to understand a project's content structure.

### What's included

The generated file lists each page with its URL, title, description, and content summary. This gives coding agents context about the site without needing to crawl it.

### Integration

Runs as a post-build step. Can also be triggered via the `nua build` CLI, which injects the agent summary automatically alongside the standard Astro build output.
