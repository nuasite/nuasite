/**
 * Semantic field type wrappers for Zod schemas in content collections.
 *
 * These are identity functions — they return exactly what's passed in.
 * The CMS collection scanner detects them by name in the source and
 * renders the appropriate editor input.
 *
 * @example
 * ```ts
 * import { field } from '@nuasite/cms'
 * import { z } from 'astro/zod'
 *
 * const schema = z.object({
 *   photo: field.image(z.string()),
 *   website: field.url(z.string()),
 *   contact: field.email(z.string()),
 *   accent: field.color(z.string()),
 *   publishedAt: field.date(z.string()),
 *   startsAt: field.datetime(z.string()),
 *   opensAt: field.time(z.string()),
 *   bio: field.textarea(z.string()),
 * })
 * ```
 */
export const field = {
	/** Image picker (opens media library) */
	image: <T>(schema: T): T => schema,
	/** URL input */
	url: <T>(schema: T): T => schema,
	/** Email input */
	email: <T>(schema: T): T => schema,
	/** Color picker */
	color: <T>(schema: T): T => schema,
	/** Date picker */
	date: <T>(schema: T): T => schema,
	/** Date + time picker */
	datetime: <T>(schema: T): T => schema,
	/** Time picker */
	time: <T>(schema: T): T => schema,
	/** Multiline textarea */
	textarea: <T>(schema: T): T => schema,
}
