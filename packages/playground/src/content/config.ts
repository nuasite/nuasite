import { defineCollection, z } from 'astro:content'

const servicesCollection = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string().nullable(),
		subtitle: z.string().nullable(),
		heroImageDesktop: z.string().nullable(),
		heroImageMobile: z.string().nullable(),
		stats: z.array(z.object({
			value: z.string(),
			label: z.string(),
		})),
		ctaText: z.string().nullable(),
		ctaLink: z.string().nullable(),
	}),
})

const blogCollection = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		author: z.string(),
		date: z.coerce.date(),
		tags: z.array(z.string()),
		excerpt: z.string(),
		coverImage: z.string(),
		draft: z.boolean().default(false),
	}),
})

const teamCollection = defineCollection({
	type: 'content',
	schema: z.object({
		name: z.string(),
		role: z.string(),
		bio: z.string(),
		avatar: z.string(),
		order: z.number(),
		social: z.object({
			twitter: z.string().optional(),
			github: z.string().optional(),
			linkedin: z.string().optional(),
		}),
	}),
})

const projectsCollection = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
		client: z.string(),
		date: z.coerce.date(),
		tags: z.array(z.string()),
		coverImage: z.string(),
		url: z.string().nullable(),
		featured: z.boolean().default(false),
	}),
})

export const collections = {
	services: servicesCollection,
	blog: blogCollection,
	team: teamCollection,
	projects: projectsCollection,
}
