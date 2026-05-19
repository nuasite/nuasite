/**
 * Central catalog of editor UI strings.
 *
 * Step 1 of the i18n groundwork — pure centralization, no locale switching.
 * Parametrized messages are exposed as functions so a future `t(key, vars)`
 * helper can swap them out without touching call sites.
 *
 * Conventions:
 * - Grouped by feature (`dialog`, `toast`, `editor`, …) — not by message kind.
 * - Static literals are plain strings; messages with variables are functions.
 * - Keep keys descriptive enough to read at the call site without context.
 */
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
		itemAdded: (position: string) => `Item added ${position} current item`,
		componentInserted: (componentName: string, position: string) => `${componentName} inserted ${position} component`,
		insertArrayFailed: 'Failed to add array item',
		insertComponentFailed: 'Failed to insert component',
		itemRemoved: 'Item removed',
		componentRemoved: 'Component removed',
		removeArrayFailed: 'Failed to remove item',
		removeComponentFailed: 'Failed to remove component',
	},

	reference: {
		updated: 'Reference updated',
		updateFailed: 'Failed to update reference',
	},
} as const
