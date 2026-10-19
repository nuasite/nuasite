# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See also the [root CLAUDE.md](../../CLAUDE.md) for monorepo-wide commands and conventions.

## Architecture

Reusable Astro component library for common site patterns. No build step — components are `.astro` files consumed directly.

### Components

#### Form (`src/form/index.astro`)

Progressive form enhancement with anti-spam protection:

- Honeypot fields for bot detection
- Client-side validation tracking mouse, keyboard, and focus events
- Minimum time-on-page (3s), keystroke count, and field interaction checks
- Headless browser detection (Puppeteer, etc.)
- Submits via `fetch` with token-based rate limiting
- Contextual success/error/loading messages
- Uses Web Components (`<astro-form>` custom element) for encapsulation

Requires either `formId` (Nua-managed endpoint) or `action` (custom URL) — enforced by union type in `types.ts`.

Supporting files:

- `src/form/types.ts` — Props union type ensuring `formId` XOR `action`
- `src/form/utils.ts` — Honeypot field names and regex validators

#### Image (`src/image/index.astro`)

Cloudflare Image Transform wrapper:

- Builds responsive `srcset` with configurable widths (default: `[480, 768, 1024, 1400]`)
- Supports absolute and relative image sources
- Optional domain whitelist
- Customizable delivery base path (default: `/cdn-cgi/image`)

#### Video (`src/video/index.astro`)

`<video>` for `n.video()` field values:

- `src` is used verbatim inside a `<source>` whose `type` comes from the extension (`utils.ts`)
- `autoplay` forces `muted` and `playsinline` — browsers block autoplay with sound, iOS needs inline
- `preload` defaults to `auto` with autoplay, `metadata` otherwise

#### Reservation (`src/reservation/`)

- `availability/index.astro` — Shows available time slots
- `checkout/index.astro` — Handles reservation booking
- `status/index.astro` — Displays reservation confirmation/status

## Key Entry Point

`src/index.ts` re-exports all components and types: `Form`, `Image`, `ReservationAvailability`, `ReservationCheckout`, `ReservationStatus`, `Search`, `Video`.
