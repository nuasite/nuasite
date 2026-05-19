/**
 * Central catalog of editor UI strings. Step 1 of i18n groundwork — no locale
 * switching yet. Parametrized messages are functions so a future `t(key, vars)`
 * helper can swap them in without touching call sites.
 */
import type { InsertPosition } from './types'

export const STRINGS = {
	dialog: {
		defaults: {
			title: 'Confirm',
			confirm: 'Confirm',
			cancel: 'Cancel',
		},
		discardAll: {
			title: 'Discard Changes',
			message: 'Discard all changes? This cannot be undone.',
			confirm: 'Discard',
			cancel: 'Cancel',
		},
		discardMarkdown: {
			title: 'Discard changes?',
			message: 'You have unsaved changes. Discard them and close?',
			confirm: 'Discard',
			cancel: 'Keep editing',
		},
	},

	toolbar: {
		selectElement: 'Select Element',
	},

	editingMode: {
		enabled: 'CMS editing enabled',
		disabled: 'CMS editing disabled',
	},

	editor: {
		formattingBlocked: "Formatting isn't available — this text is used as a plain value",
		lockedElement: "This text can't be edited here — no source file is linked to it",
		markdownNotInManifest: 'Markdown element not found in manifest',
		noMarkdownPath: 'No markdown file path configured for this element',
		markdownContentMissing: 'Markdown content not found',
		markdownLoadFailed: (message: string) => `Failed to load markdown: ${message}`,
	},

	save: {
		success: (updated: number) => `Saved ${updated} change(s) successfully!`,
		failed: (details: string) => `Save failed: ${details}`,
		discarded: 'All changes discarded',
		noCollectionContent: 'No collection content found on this page',
	},

	block: {
		propsPreviewOnly: 'Props updated (preview only)',
		insertItem: (position: InsertPosition) => `Item added ${position} current item`,
		insertComponent: (componentName: string, position: InsertPosition) => `${componentName} inserted ${position} component`,
		insertItemFailed: 'Failed to add array item',
		insertComponentFailed: 'Failed to insert component',
		removeItem: 'Item removed',
		removeComponent: 'Component removed',
		removeItemFailed: 'Failed to remove item',
		removeComponentFailed: 'Failed to remove component',
	},

	reference: {
		updated: 'Reference updated',
		updateFailed: 'Failed to update reference',
	},

	markdown: {
		saveSuccess: 'Content saved',
		saveFailed: 'Failed to save markdown',
		saveFailedDetails: (message: string) => `Save failed: ${message}`,
		initFailed: 'Failed to initialize markdown editor',
		titleRequired: 'Please enter a title',
		slugRequired: 'Please enter a slug',
		pageCreated: 'Page created',
		createFailed: 'Failed to create page',
		createFailedDetails: (message: string) => `Create failed: ${message}`,
		previewElementMissing: 'Could not find page element to preview',
		previewGenerationFailed: 'Failed to generate preview',
	},

	media: {
		notConfigured: 'CMS not configured',
		loadFailed: 'Failed to load media library',
		imageRequired: 'Please drop an image file',
		uploadSucceeded: 'File uploaded successfully',
		uploadedNextToEntry: 'Uploaded next to entry',
		fileUploaded: 'File uploaded',
		imageInserted: 'Image uploaded and inserted',
		uploadFailed: 'Upload failed',
		invalidFolderName: 'Invalid folder name',
		folderCreated: 'Folder created',
		folderCreateFailed: 'Failed to create folder',
	},

	redirects: {
		updated: 'Redirect updated',
		updateFailed: 'Failed to update',
		deleted: 'Redirect deleted',
		deleteFailed: 'Failed to delete',
		added: 'Redirect added',
		addFailed: 'Failed to add redirect',
	},

	slug: {
		updated: 'Slug updated',
		renameFailed: 'Failed to rename',
	},

	page: {
		deleted: 'Page deleted',
		deleteFailed: 'Failed to delete page',
	},

	seo: {
		saveSuccess: (updated: number) => `Saved ${updated} SEO change(s) successfully!`,
		saveFailed: (details: string) => `SEO save failed: ${details}`,
		saveFailedFallback: 'Failed to save SEO changes',
	},
} as const
