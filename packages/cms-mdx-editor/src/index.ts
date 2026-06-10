/**
 * `@nuasite/cms-mdx-editor` — React MDX body editor (Milkdown) for Nua CMS
 * collection entries. Round-trips component blocks (props, children, expression
 * props, imports) through the editor; rich-text toolbar, nested WYSIWYG slot
 * editing, and a media library for image props and prose images. String in / out.
 *
 * Mount `<MdxBodyEditor value onChange components={…} media={client} mediaContext={…} />`;
 * feed `components` from `cmsClient.getComponents()` and `media` is the host's
 * `CmsClient` (it satisfies `MediaSource`). Consumed by `@nuasite/collections-admin`
 * and the webmaster collections tab.
 */
// Re-export the wire contract's runtime field-type guard so consumers can drive
// field UIs off the same source of truth — and so `@nuasite/cms-types` stays a
// genuine runtime dependency (its types appear in this package's public API, so
// it must be installed for consumers, not a devDependency). Mirrors how
// cms-client / collections-admin / cms-sidecar surface the contract.
export { FIELD_TYPES, isFieldType } from '@nuasite/cms-types'
export { ComponentPicker, type ComponentPickerProps } from './component-picker'
export { FormatToolbar, type FormatToolbarProps, useFormatTracking } from './format-toolbar'
export { LinkPopover, type LinkPopoverProps } from './link-popover'
export { MdxBlockCard, type MdxBlockCardProps } from './mdx-block-card'
export { MdxBodyEditor, type MdxBodyEditorProps } from './mdx-body-editor'
export { type InsertMdxComponentPayload, MDX_EXPR_PREFIX } from './mdx-plugin'
export { MediaLibrary, type MediaLibraryProps } from './media-library'
export { isMediaUnavailableError, type MediaContext, type MediaSource, type MediaUploadContext } from './media-source'
export { SlotEditor } from './slot-editor'
