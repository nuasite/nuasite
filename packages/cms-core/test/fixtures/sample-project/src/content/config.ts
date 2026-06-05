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

export const collections = { blog, authors }
