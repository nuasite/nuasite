import { defineCollection, getCollection, z } from 'astro:content'
import { file } from 'astro/loaders'

const playgroundComponents = defineCollection({
	loader: file('src/data/components.json'),
	type: 'content_layer',
	schema: z.object({
		slug: z.string(),
		name: z.string(),
		githubUrl: z.string().url(),
		tagline: z.string(),
		description: z.string(),
		status: z.enum(['ready', 'beta', 'soon']).default('ready'),
		order: z.number().optional(),
		highlights: z.array(z.string()),
		props: z.array(
			z.object({
				name: z.string(),
				required: z.boolean().optional(),
				description: z.string(),
			}),
		),
	}),
})

export const collections = {
	playgroundComponents
}

export const allPlaygroundComponents = await getCollection('playgroundComponents')
