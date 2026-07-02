import { n } from '@nuasite/cms'
import { z } from 'astro/zod'
import { defineCollection, reference } from 'astro:content'

const blog = defineCollection({
	schema: ({ image }) =>
		z.object({
			title: n.text({ maxLength: 120 }),
			date: n.date().orderBy('desc'),
			draft: n.boolean(),
			cover: image(),
			tags: z.array(z.string()),
			author: reference('authors'),
		}),
})

const authors = defineCollection({
	schema: z.object({
		title: n.text(),
		bio: n.textarea({ rows: 4 }),
	}),
})

// A collection whose page URL is composed from fields (not its filename slug),
// via a declarative `cms.pathname` rule. Files are named `<role>__<slug>.md`
// but served at `/<urlFamily>/<slug>`, so the on-disk slug never matches the URL.
const people = defineCollection({
	schema: z.object({
		title: n.text(),
		urlFamily: z.string(),
		slug: z.string(),
	}),
	cms: { pathname: [{ field: 'urlFamily' }, { field: 'slug' }] },
})

export const collections = { blog, authors, people }
