import { z } from 'astro/zod'

/**
 * Schema helpers for content collections.
 *
 * Combines Zod passthrough methods with CMS-aware semantic types,
 * so a content config can import only `n` instead of both `n` and `z`.
 *
 * Pass an options object to configure editor hints and Zod validation
 * in one place. Chain `.orderBy('asc' | 'desc')` to mark the ordering field.
 *
 * @example
 * ```ts
 * import { n } from '@nuasite/cms'
 *
 * const schema = n.object({
 *   title: n.text({ placeholder: "Enter title", maxLength: 120 }),
 *   photo: n.image(),
 *   bio: n.textarea({ rows: 4, maxLength: 500 }),
 *   order: n.number({ min: 1, max: 100, step: 1 }).orderBy('asc'),
 *   date: n.date().orderBy('desc'),
 *   tags: n.array(n.string()),
 *   featured: n.boolean().default(false),
 * })
 * ```
 */

// --- Per-type hint interfaces ---

export interface NumberHints {
	min?: number
	max?: number
	step?: number
	placeholder?: string
}

export interface TextHints {
	placeholder?: string
	maxLength?: number
	minLength?: number
}

export interface TextareaHints {
	placeholder?: string
	maxLength?: number
	rows?: number
}

export interface DateHints {
	min?: string
	max?: string
}

export interface ImageHints {
	accept?: string
}

// --- Internals ---

type OrderByDirection = 'asc' | 'desc'
type WithOrderBy<T> = T & { orderBy(direction?: OrderByDirection): T }

/** Normalize YAML Date objects to ISO date strings (YYYY-MM-DD) */
const toISODate = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)
/** Normalize YAML Date objects to ISO datetime strings */
const toISODatetime = (v: unknown) => (v instanceof Date ? v.toISOString() : v)

const WRAPPING_METHODS = ['default', 'optional', 'nullable', 'nullish'] as const

/**
 * Add a chainable `.orderBy()` method to a Zod schema. The scanner detects it from source code.
 *
 * Also wraps the Zod methods that produce a new schema instance (`.default()`, `.optional()`,
 * `.nullable()`, `.nullish()`) so the marker survives those wrappers — chain order doesn't matter.
 */
function withOrderBy<T extends z.ZodTypeAny>(schema: T): WithOrderBy<T> {
	const s = schema as WithOrderBy<T>
	s.orderBy = (_direction?: OrderByDirection) => schema
	for (const method of WRAPPING_METHODS) {
		const original = (schema as unknown as Record<string, unknown>)[method]
		if (typeof original !== 'function') continue
		;(s as unknown as Record<string, unknown>)[method] = function(this: unknown, ...args: unknown[]) {
			return withOrderBy((original as (...a: unknown[]) => z.ZodTypeAny).apply(this, args))
		}
	}
	return s
}

/** Build a CMS string field with optional length validation. Shared by text, url, email, textarea. */
function stringField(cmsType: string, hints?: { minLength?: number; maxLength?: number }) {
	let schema = z.string()
	if (hints?.minLength != null) schema = schema.min(hints.minLength)
	if (hints?.maxLength != null) schema = schema.max(hints.maxLength)
	return withOrderBy(schema.describe(`cms:${cmsType}`))
}

export const n = {
	// --- Zod passthroughs ---
	/** Object schema */
	object: <T extends z.ZodRawShape>(shape: T) => z.object(shape),
	/** Array schema */
	array: <T extends z.ZodTypeAny>(schema: T) => z.array(schema),
	/** Enum schema */
	enum: <U extends string, T extends [U, ...U[]]>(values: T) => z.enum(values),
	/** Coerce namespace — parses input into the target type */
	coerce: {
		date: () => withOrderBy(z.coerce.date()),
		number: () => withOrderBy(z.coerce.number()),
		string: () => withOrderBy(z.coerce.string()),
		boolean: () => withOrderBy(z.coerce.boolean()),
	},

	// --- CMS semantic types ---
	/** Boolean / checkbox */
	boolean: () => withOrderBy(z.boolean().describe('cms:checkbox')),
	/** Number input with optional min/max/step */
	number: (hints?: NumberHints) => {
		let schema = z.number()
		if (hints?.min != null) schema = schema.min(hints.min)
		if (hints?.max != null) schema = schema.max(hints.max)
		return withOrderBy(schema.describe('cms:number'))
	},
	/** Image picker (opens media library). Accepts hints for the scanner; no Zod validation applied. */
	image: (_hints?: ImageHints) => withOrderBy(z.string().describe('cms:image')),
	/** URL input */
	url: (hints?: TextHints) => stringField('url', hints),
	/** Email input */
	email: (hints?: TextHints) => stringField('email', hints),
	/** Phone number input */
	tel: (hints?: TextHints) => stringField('tel', hints),
	/** Color picker */
	color: () => withOrderBy(z.string().describe('cms:color')),
	/** Date picker (handles YAML Date coercion → ISO date string). Accepts hints for the scanner; no Zod validation applied. */
	date: (_hints?: DateHints) => withOrderBy(z.preprocess(toISODate, z.string()).describe('cms:date')),
	/** Date + time picker (handles YAML Date coercion → ISO datetime string). Accepts hints for the scanner; no Zod validation applied. */
	datetime: (_hints?: DateHints) => withOrderBy(z.preprocess(toISODatetime, z.string()).describe('cms:datetime')),
	/** Time picker. Accepts hints for the scanner; no Zod validation applied. */
	time: (_hints?: DateHints) => withOrderBy(z.string().describe('cms:time')),
	/** Multiline textarea */
	textarea: (hints?: TextareaHints) => stringField('textarea', hints),
	/** Text input */
	text: (hints?: TextHints) => stringField('text', hints),
	/** Plain string (no CMS type hint — type inferred from values) */
	string: () => withOrderBy(z.string()),
}
