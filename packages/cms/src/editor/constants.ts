/**
 * Constants for the CMS editor
 * Centralizes magic numbers and configuration values
 */

/**
 * Z-index layers for CMS UI elements.
 * Uses high values to ensure CMS UI appears above all page content.
 * Each layer is ordered from back to front.
 */
export const Z_INDEX = {
	/** Highlight overlay for hovered elements */
	HIGHLIGHT: 2147483645,
	/** Overlay backdrop for modals */
	OVERLAY: 2147483646,
	/** Modal panels (block editor, AI chat) */
	MODAL: 2147483647,
	/** Toast notifications - always on top */
	TOAST: 2147483648,
} as const

/**
 * Timing constants for UI interactions
 */
export const TIMING = {
	/** Throttle interval for element detection during mouse move (ms) */
	ELEMENT_DETECTION_THROTTLE_MS: 16,
	/** Delay before clearing focus state on blur (ms) */
	BLUR_DELAY_MS: 10,
	/** Duration before toast starts fading out (ms) */
	TOAST_VISIBLE_DURATION_MS: 2200,
	/** Duration of toast fade out animation (ms) */
	TOAST_FADE_DURATION_MS: 200,
	/** Duration to show component insertion preview before removal (ms) */
	PREVIEW_SUCCESS_DURATION_MS: 3000,
	/** Duration to show error preview before removal (ms) */
	PREVIEW_ERROR_DURATION_MS: 5000,
	/** Delay before focusing input after expansion (ms) */
	FOCUS_DELAY_MS: 50,
} as const

/**
 * Layout constants for UI positioning
 */
export const LAYOUT = {
	/** Edge threshold for component selection (pixels from border) */
	COMPONENT_EDGE_THRESHOLD: 32,
	/** Minimum space needed to show label outside the element */
	LABEL_OUTSIDE_THRESHOLD: 28,
	/** Padding from viewport edges for sticky label */
	STICKY_PADDING: 8,
	/** Default padding from viewport edges */
	VIEWPORT_PADDING: 16,
	/** Default tooltip width */
	TOOLTIP_WIDTH: 200,
	/** Expanded tooltip minimum width */
	TOOLTIP_EXPANDED_MIN_WIDTH: 280,
	/** Expanded tooltip maximum width */
	TOOLTIP_EXPANDED_MAX_WIDTH: 320,
	/** Block editor panel width */
	BLOCK_EDITOR_WIDTH: 400,
	/** Block editor approximate height for positioning */
	BLOCK_EDITOR_HEIGHT: 500,
	/** AI chat panel width */
	AI_CHAT_WIDTH: 400,
} as const

/**
 * API request configuration
 */
export const API = {
	/** Default request timeout in milliseconds */
	REQUEST_TIMEOUT_MS: 30000,
	/** AI streaming request timeout in milliseconds */
	AI_STREAM_TIMEOUT_MS: 120000,
	/** Maximum retry attempts for failed requests */
	MAX_RETRIES: 3,
	/** Base delay for exponential backoff (ms) */
	RETRY_BASE_DELAY_MS: 1000,
} as const

/**
 * Storage keys for persistence
 */
export const STORAGE_KEYS = {
	PENDING_EDITS: 'cms-pending-edits',
	PENDING_IMAGE_EDITS: 'cms-pending-image-edits',
	PENDING_COLOR_EDITS: 'cms-pending-color-edits',
	PENDING_ATTRIBUTE_EDITS: 'cms-pending-attribute-edits',
	PENDING_BG_IMAGE_EDITS: 'cms-pending-bg-image-edits',
	SETTINGS: 'cms-settings',
	PENDING_ENTRY_NAVIGATION: 'cms-pending-entry-navigation',
	IS_EDITING: 'cms-is-editing',
} as const

/**
 * CSS class prefixes and identifiers
 */
export const CSS = {
	/** Data attribute for CMS UI elements (to prevent event propagation) */
	UI_ATTRIBUTE: 'data-cms-ui',
	/** Data attribute for CMS element IDs */
	ID_ATTRIBUTE: 'data-cms-id',
	/** Data attribute for component IDs */
	COMPONENT_ID_ATTRIBUTE: 'data-cms-component-id',
	/** Custom element tag for highlight overlay */
	HIGHLIGHT_ELEMENT: 'cms-highlight-overlay',
	/** Data attribute for background image elements */
	BG_IMAGE_ATTRIBUTE: 'data-cms-bg-img',
} as const
