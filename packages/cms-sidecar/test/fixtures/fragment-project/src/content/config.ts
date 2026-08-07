import { n } from '@nuasite/cms'
import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'

// Rendered as cards inside `/aktualne` (the `[slug]` detail enumerates it), but owns no
// page of its own — `previewOf` names where an editor can see an entry, nothing more.
const tips = defineCollection({
	schema: z.object({
		title: n.text(),
	}),
	cms: { fragment: true, previewOf: '/aktualne' },
})

// A fragment rendered on a static listing page: the route resolver maps it to that one
// page's URL, which is the *listing's* URL and never the testimonial's.
const testimonials = defineCollection({
	schema: z.object({
		title: n.text(),
	}),
	cms: { fragment: true },
})

// `fragment` and `pathname` contradict each other; the config parser drops the rule (with
// a warning), so no spec-derived URL can reach the entries either.
const tags = defineCollection({
	schema: z.object({
		title: n.text(),
		slug: n.text(),
	}),
	cms: { fragment: true, pathname: [{ literal: 'stitky' }, { field: 'slug' }] },
})

// Not a fragment: driven page-per-item by the same `[slug]` detail as `tips`, so it must
// still get the route-prefix fallback. `previewOf` without `fragment` is inert.
const articles = defineCollection({
	schema: z.object({
		title: n.text(),
	}),
	cms: { previewOf: '/aktualne' },
})

export const collections = { tips, testimonials, tags, articles }
