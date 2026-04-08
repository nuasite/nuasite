/**
 * Semantic prop types for CMS component editing.
 *
 * Import these in Astro component Props to get the right editor input:
 *
 * ```astro
 * ---
 * import type { Image, Url } from '@nuasite/cms'
 *
 * interface Props {
 *   src: Image
 *   href: Url
 * }
 * ---
 * ```
 *
 * At runtime these are just `string`, but the CMS editor reads
 * the type name from source and renders the appropriate input widget.
 */

/** Opens the media library picker */
export type Image = string

/** Text input with URL validation */
export type Url = string

/** Color picker input */
export type Color = string

/** Date picker input */
export type Date = string

/** Date and time picker input */
export type DateTime = string

/** Time picker input */
export type Time = string

/** Email input with validation */
export type Email = string

/** Multiline text area */
export type Textarea = string

/** Collection entry reference — renders a dropdown of entries from the named collection */
export type Reference<_Collection extends string = string> = string
