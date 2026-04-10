import { z } from 'astro/zod'

/**
 * Semantic field type schemas for content collections.
 *
 * Each method returns a `z.string()` schema that Astro resolves
 * statically (concrete return type, no generics). The CMS collection
 * scanner detects them by name in the source and renders the
 * appropriate editor input.
 *
 * Chain Zod methods as usual (`.optional()`, `.default()`, etc.).
 *
 * @example
 * ```ts
 * import { n } from '@nuasite/cms'
 * import { z } from 'astro/zod'
 *
 * const schema = z.object({
 *   photo: n.image(),
 *   website: n.url().optional(),
 *   contact: n.email(),
 *   accent: n.color(),
 *   publishedAt: n.date(),
 *   startsAt: n.datetime(),
 *   opensAt: n.time(),
 *   bio: n.textarea(),
 * })
 * ```
 */
export const n = {
	/** Image picker (opens media library) */
	image: () => z.string().describe('cms:image'),
	/** URL input */
	url: () => z.string().describe('cms:url'),
	/** Email input */
	email: () => z.string().describe('cms:email'),
	/** Color picker */
	color: () => z.string().describe('cms:color'),
	/** Date picker */
	date: () => z.string().describe('cms:date'),
	/** Date + time picker */
	datetime: () => z.string().describe('cms:datetime'),
	/** Time picker */
	time: () => z.string().describe('cms:time'),
	/** Multiline textarea */
	textarea: () => z.string().describe('cms:textarea'),
}