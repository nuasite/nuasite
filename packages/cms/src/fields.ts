/**
 * Schema helpers for content collections, with nothing that needs Node.
 *
 * Served as `@nuasite/cms/fields`, and as `@nuasite/cms` itself under the `workerd` export
 * condition, so a content config written against either keeps working when a host evaluates
 * it outside Node (a Cloudflare Worker, for example). Everything here must stay importable
 * there: no `node:*` built-ins and no Astro integration code.
 */
export { FIELD_TYPES, isFieldType } from '@nuasite/cms-types'
export type { CollectionLayout, CollectionLayoutSection, PathnameSegment, PathnameSpec } from '@nuasite/cms-types'
export { defineCmsCollection, n } from './field-types'
export type { DateHints, FileHints, ImageHints, LayoutHints, NumberHints, TextareaHints, TextHints } from './field-types'
export type { Color, Date, DateTime, Email, Image, Reference, Textarea, Time, Url } from './prop-types'
