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

export const collections = {
	services: servicesCollection,
}
