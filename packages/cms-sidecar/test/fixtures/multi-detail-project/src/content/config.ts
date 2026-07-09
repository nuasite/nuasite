import { n } from '@nuasite/cms'
import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'

const products = defineCollection({
	schema: z.object({
		title: n.text(),
		slug: n.text(),
	}),
})

const references = defineCollection({
	schema: z.object({
		title: n.text(),
		slug: n.text(),
	}),
})

const posts = defineCollection({
	schema: z.object({
		title: n.text(),
		slug: n.text(),
	}),
})

const authors = defineCollection({
	schema: z.object({
		title: n.text(),
		bio: n.textarea(),
	}),
})

export const collections = { products, references, posts, authors }
