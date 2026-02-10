import { useCallback, useEffect, useMemo } from 'preact/hooks'
import { Z_INDEX } from '../constants'
import * as signals from '../signals'
import { saveAttributeEditsToStorage } from '../storage'
import type { Attribute } from '../types'
import { ComboBoxField, FieldLabel, ImageField, NumberField, SelectField, TextField, ToggleField } from './fields'

// ============================================================================
// Attribute Field Configuration
// ============================================================================

type FieldType = 'text' | 'select' | 'toggle' | 'number' | 'media-src' | 'href'

interface FieldConfig {
	type: FieldType
	label: string
	options?: Array<{ value: string; label: string }>
	placeholder?: string
	min?: number
	max?: number
}

/** Maps attribute names to their smart field type and options */
const ATTRIBUTE_FIELD_CONFIG: Record<string, FieldConfig> = {
	// Link / navigation
	href: { type: 'href', label: 'URL (href)', placeholder: 'https://example.com or /page' },
	target: {
		type: 'select',
		label: 'Target',
		options: [
			{ value: '_self', label: 'Same window (_self)' },
			{ value: '_blank', label: 'New window (_blank)' },
			{ value: '_parent', label: 'Parent frame (_parent)' },
			{ value: '_top', label: 'Top frame (_top)' },
		],
	},
	rel: { type: 'text', label: 'Rel', placeholder: 'noopener noreferrer' },
	title: { type: 'text', label: 'Title', placeholder: 'Title text' },

	// Button
	type: {
		type: 'select',
		label: 'Type',
		options: [
			{ value: 'button', label: 'Button' },
			{ value: 'submit', label: 'Submit' },
			{ value: 'reset', label: 'Reset' },
			{ value: 'text', label: 'Text' },
			{ value: 'email', label: 'Email' },
			{ value: 'password', label: 'Password' },
			{ value: 'number', label: 'Number' },
			{ value: 'tel', label: 'Phone' },
			{ value: 'url', label: 'URL' },
			{ value: 'search', label: 'Search' },
			{ value: 'date', label: 'Date' },
			{ value: 'time', label: 'Time' },
			{ value: 'datetime-local', label: 'Datetime' },
			{ value: 'checkbox', label: 'Checkbox' },
			{ value: 'radio', label: 'Radio' },
			{ value: 'file', label: 'File' },
			{ value: 'hidden', label: 'Hidden' },
		],
	},

	// Form
	action: { type: 'text', label: 'Action', placeholder: '/submit' },
	method: {
		type: 'select',
		label: 'Method',
		options: [
			{ value: 'get', label: 'GET' },
			{ value: 'post', label: 'POST' },
		],
	},
	enctype: {
		type: 'select',
		label: 'Encoding Type',
		options: [
			{ value: 'application/x-www-form-urlencoded', label: 'URL Encoded (default)' },
			{ value: 'multipart/form-data', label: 'Multipart (for files)' },
			{ value: 'text/plain', label: 'Plain Text' },
		],
	},

	// Input
	name: { type: 'text', label: 'Name', placeholder: 'field-name' },
	placeholder: { type: 'text', label: 'Placeholder', placeholder: 'Enter value...' },
	pattern: { type: 'text', label: 'Pattern', placeholder: '[A-Za-z]+' },
	value: { type: 'text', label: 'Value', placeholder: 'Default value' },
	autocomplete: {
		type: 'select',
		label: 'Autocomplete',
		options: [
			{ value: 'on', label: 'On' },
			{ value: 'off', label: 'Off' },
			{ value: 'name', label: 'Name' },
			{ value: 'email', label: 'Email' },
			{ value: 'username', label: 'Username' },
			{ value: 'current-password', label: 'Current Password' },
			{ value: 'new-password', label: 'New Password' },
			{ value: 'tel', label: 'Phone' },
			{ value: 'address-line1', label: 'Address Line 1' },
			{ value: 'address-line2', label: 'Address Line 2' },
			{ value: 'city', label: 'City' },
			{ value: 'postal-code', label: 'Postal Code' },
			{ value: 'country', label: 'Country' },
		],
	},
	inputmode: {
		type: 'select',
		label: 'Input Mode',
		options: [
			{ value: 'text', label: 'Text' },
			{ value: 'decimal', label: 'Decimal' },
			{ value: 'numeric', label: 'Numeric' },
			{ value: 'tel', label: 'Phone' },
			{ value: 'email', label: 'Email' },
			{ value: 'url', label: 'URL' },
			{ value: 'search', label: 'Search' },
			{ value: 'none', label: 'None' },
		],
	},

	// Media
	src: { type: 'media-src', label: 'Source (src)', placeholder: '/media/file.mp4' },
	poster: { type: 'text', label: 'Poster', placeholder: '/media/poster.jpg' },
	loading: {
		type: 'select',
		label: 'Loading',
		options: [
			{ value: 'eager', label: 'Eager' },
			{ value: 'lazy', label: 'Lazy' },
		],
	},
	preload: {
		type: 'select',
		label: 'Preload',
		options: [
			{ value: 'auto', label: 'Auto' },
			{ value: 'metadata', label: 'Metadata only' },
			{ value: 'none', label: 'None' },
		],
	},

	// Iframe
	allow: { type: 'text', label: 'Allow', placeholder: 'camera; microphone' },
	sandbox: { type: 'text', label: 'Sandbox', placeholder: 'allow-scripts allow-same-origin' },

	// Textarea
	wrap: {
		type: 'select',
		label: 'Wrap',
		options: [
			{ value: 'soft', label: 'Soft' },
			{ value: 'hard', label: 'Hard' },
			{ value: 'off', label: 'Off' },
		],
	},

	// Toggle (boolean) attributes
	disabled: { type: 'toggle', label: 'Disabled' },
	required: { type: 'toggle', label: 'Required' },
	readonly: { type: 'toggle', label: 'Read Only' },
	multiple: { type: 'toggle', label: 'Multiple' },
	controls: { type: 'toggle', label: 'Controls' },
	autoplay: { type: 'toggle', label: 'Autoplay' },
	muted: { type: 'toggle', label: 'Muted' },
	loop: { type: 'toggle', label: 'Loop' },
	novalidate: { type: 'toggle', label: 'Disable Validation' },
	download: { type: 'toggle', label: 'Download' },
	'aria-hidden': { type: 'toggle', label: 'Hidden (ARIA)' },
	'aria-expanded': { type: 'toggle', label: 'Expanded (ARIA)' },
	'aria-disabled': { type: 'toggle', label: 'Disabled (ARIA)' },

	// Number attributes
	rows: { type: 'number', label: 'Rows', min: 1 },
	cols: { type: 'number', label: 'Cols', min: 1 },
	min: { type: 'text', label: 'Min', placeholder: '0' },
	max: { type: 'text', label: 'Max', placeholder: '100' },
	minlength: { type: 'number', label: 'Min Length', min: 0 },
	maxlength: { type: 'number', label: 'Max Length', min: 0 },
	size: { type: 'number', label: 'Size', min: 1 },
	width: { type: 'text', label: 'Width', placeholder: '100%' },
	height: { type: 'text', label: 'Height', placeholder: '400' },
	step: { type: 'text', label: 'Step', placeholder: '1' },

	// ARIA
	role: {
		type: 'select',
		label: 'Role',
		options: [
			{ value: 'button', label: 'Button' },
			{ value: 'link', label: 'Link' },
			{ value: 'tab', label: 'Tab' },
			{ value: 'tabpanel', label: 'Tab Panel' },
			{ value: 'dialog', label: 'Dialog' },
			{ value: 'navigation', label: 'Navigation' },
			{ value: 'banner', label: 'Banner' },
			{ value: 'main', label: 'Main' },
			{ value: 'complementary', label: 'Complementary' },
			{ value: 'contentinfo', label: 'Content Info' },
			{ value: 'search', label: 'Search' },
			{ value: 'form', label: 'Form' },
			{ value: 'region', label: 'Region' },
			{ value: 'alert', label: 'Alert' },
			{ value: 'alertdialog', label: 'Alert Dialog' },
			{ value: 'menu', label: 'Menu' },
			{ value: 'menuitem', label: 'Menu Item' },
			{ value: 'listbox', label: 'Listbox' },
			{ value: 'option', label: 'Option' },
			{ value: 'tree', label: 'Tree' },
			{ value: 'treeitem', label: 'Tree Item' },
			{ value: 'grid', label: 'Grid' },
			{ value: 'row', label: 'Row' },
			{ value: 'cell', label: 'Cell' },
		],
	},
	'aria-label': { type: 'text', label: 'Label (ARIA)', placeholder: 'Accessible label' },
	'aria-labelledby': { type: 'text', label: 'Labelled By (ARIA)', placeholder: 'element-id' },
	'aria-describedby': { type: 'text', label: 'Described By (ARIA)', placeholder: 'description-id' },
	'aria-live': {
		type: 'select',
		label: 'Live Region (ARIA)',
		options: [
			{ value: 'polite', label: 'Polite' },
			{ value: 'assertive', label: 'Assertive' },
			{ value: 'off', label: 'Off' },
		],
	},

	// Form element attributes
	form: { type: 'text', label: 'Form ID', placeholder: 'form-id' },
	formaction: { type: 'text', label: 'Form Action', placeholder: '/submit' },
	formmethod: {
		type: 'select',
		label: 'Form Method',
		options: [
			{ value: 'get', label: 'GET' },
			{ value: 'post', label: 'POST' },
		],
	},
}

/** Get field config for an attribute, falling back to text field */
function getFieldConfig(attrName: string): FieldConfig {
	return ATTRIBUTE_FIELD_CONFIG[attrName] || {
		type: 'text' as const,
		label: attrName,
		placeholder: `${attrName} value`,
	}
}

/** Helper to compare attribute values (handles undefined, strings, booleans, numbers) */
function isValueDirty(newVal: any, origVal: any): boolean {
	const normalizeValue = (v: any) => {
		if (v === null || v === '' || v === undefined) return undefined
		return v
	}
	return normalizeValue(newVal) !== normalizeValue(origVal)
}

// ============================================================================
// Dynamic Attribute Field Renderer
// ============================================================================

interface AttributeFieldProps {
	attrName: string
	currentAttr: Attribute | undefined
	originalAttr: Attribute | undefined
	pages: Array<{ url: string; title?: string }>
	onUpdate: (value: string) => void
	onReset: () => void
	onOpenMediaLibrary: () => void
}

function AttributeField({ attrName, currentAttr, originalAttr, pages, onUpdate, onReset, onOpenMediaLibrary }: AttributeFieldProps) {
	const config = getFieldConfig(attrName)
	const currentValue = currentAttr?.value ?? ''
	const originalValue = originalAttr?.value ?? ''
	const isDirty = isValueDirty(currentValue, originalValue)
	const handleReset = isDirty ? onReset : undefined

	switch (config.type) {
		case 'select':
			return (
				<SelectField
					label={config.label}
					value={currentValue || undefined}
					options={config.options || []}
					onChange={(v) => onUpdate(v)}
					isDirty={isDirty}
					onReset={handleReset}
				/>
			)

		case 'toggle': {
			// For toggle, an attribute with empty string value means "present" (true)
			const isPresent = currentAttr !== undefined && currentValue !== 'false'
			return (
				<ToggleField
					label={config.label}
					value={isPresent}
					onChange={(v) => onUpdate(v ? 'true' : 'false')}
					isDirty={isDirty}
					onReset={handleReset}
				/>
			)
		}

		case 'number': {
			const numValue = currentValue ? Number(currentValue) : undefined
			return (
				<NumberField
					label={config.label}
					value={numValue}
					placeholder={config.placeholder}
					min={config.min}
					max={config.max}
					onChange={(v) => onUpdate(v === undefined ? '' : String(v))}
					isDirty={isDirty}
					onReset={handleReset}
				/>
			)
		}

		case 'media-src':
			return (
				<ImageField
					label={config.label}
					value={currentValue || undefined}
					placeholder={config.placeholder}
					onChange={(v) => onUpdate(v)}
					onBrowse={onOpenMediaLibrary}
					isDirty={isDirty}
					onReset={handleReset}
				/>
			)

		case 'href': {
			const pageOptions = pages.map(p => ({
				value: p.url,
				label: p.title || p.url,
				description: p.title ? p.url : undefined,
			}))
			return (
				<ComboBoxField
					label={config.label}
					value={currentValue || undefined}
					placeholder={config.placeholder}
					options={pageOptions}
					onChange={(v) => onUpdate(v)}
					isDirty={isDirty}
					onReset={handleReset}
				/>
			)
		}

		default:
			return (
				<TextField
					label={config.label}
					value={currentValue || undefined}
					placeholder={config.placeholder}
					onChange={(v) => onUpdate(v)}
					isDirty={isDirty}
					onReset={handleReset}
				/>
			)
	}
}

// ============================================================================
// Main Component
// ============================================================================

export interface AttributeEditorProps {
	onClose?: () => void
}

export function AttributeEditor({ onClose }: AttributeEditorProps) {
	const visible = signals.isAttributeEditorOpen.value
	const targetElementId = signals.attributeEditorTargetId.value
	const config = signals.config.value
	const manifest = signals.manifest.value

	// Force re-render when pendingAttributeChanges updates by reading the whole map
	const pendingAttributeChangesMap = signals.pendingAttributeChanges.value

	// Get the pending attribute change and manifest entry
	const pendingChange = targetElementId
		? pendingAttributeChangesMap.get(targetElementId)
		: null
	const entry = targetElementId ? manifest.entries[targetElementId] : null

	// Get page URLs for link suggestions
	const pages = useMemo(() => {
		return (manifest.pages || []).map(page => ({
			url: page.pathname,
			title: page.title,
		}))
	}, [manifest.pages])

	// Count dirty attributes
	let dirtyCount = 0
	if (pendingChange) {
		const { originalAttributes, newAttributes } = pendingChange
		const allKeys = new Set([...Object.keys(originalAttributes), ...Object.keys(newAttributes)])
		for (const key of allKeys) {
			if (isValueDirty(newAttributes[key]?.value, originalAttributes[key]?.value)) {
				dirtyCount++
			}
		}
	}

	// Handle close
	const handleClose = useCallback(() => {
		signals.closeAttributeEditor()
		onClose?.()
	}, [onClose])

	// Close on click outside
	useEffect(() => {
		if (!visible) return

		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as HTMLElement
			if (target.closest('[data-cms-ui]')) return
			handleClose()
		}

		const timeout = setTimeout(() => {
			document.addEventListener('click', handleClickOutside)
		}, 100)

		return () => {
			clearTimeout(timeout)
			document.removeEventListener('click', handleClickOutside)
		}
	}, [visible, handleClose])

	// Handle attribute update
	const handleAttrUpdate = useCallback((attrName: string, newValue: string) => {
		if (!targetElementId) return

		signals.updatePendingAttributeChange(targetElementId, (currentChange) => {
			const newAttributes = { ...currentChange.newAttributes }
			const existingAttr = newAttributes[attrName] || currentChange.originalAttributes[attrName]
			newAttributes[attrName] = {
				...(existingAttr || {}),
				value: newValue,
			}

			// Check if dirty
			let isDirty = false
			const allKeys = new Set([...Object.keys(currentChange.originalAttributes), ...Object.keys(newAttributes)])
			for (const key of allKeys) {
				if (isValueDirty(newAttributes[key]?.value, currentChange.originalAttributes[key]?.value)) {
					isDirty = true
					break
				}
			}

			// Apply to DOM element
			if (currentChange.element) {
				const booleanAttrs = new Set([
					'disabled',
					'required',
					'readonly',
					'multiple',
					'controls',
					'autoplay',
					'muted',
					'loop',
					'novalidate',
					'download',
					'aria-hidden',
					'aria-expanded',
					'aria-disabled',
				])

				if (booleanAttrs.has(attrName)) {
					if (newValue === 'true' || newValue === '') {
						currentChange.element.setAttribute(attrName, '')
					} else {
						currentChange.element.removeAttribute(attrName)
					}
				} else if (newValue === '' || newValue === undefined) {
					currentChange.element.removeAttribute(attrName)
				} else {
					currentChange.element.setAttribute(attrName, newValue)
				}
			}

			return {
				...currentChange,
				newAttributes,
				isDirty,
			}
		})

		// Save to storage for persistence
		saveAttributeEditsToStorage(signals.pendingAttributeChanges.value)
	}, [targetElementId])

	// Open media library for src selection
	const handleOpenMediaLibrary = useCallback(() => {
		signals.openMediaLibraryWithCallback((url: string) => {
			if (!targetElementId) return
			handleAttrUpdate('src', url)
		})
	}, [targetElementId, handleAttrUpdate])

	if (!visible || !targetElementId || !pendingChange) {
		return null
	}

	const { originalAttributes, newAttributes } = pendingChange

	// Get sorted attribute names
	const attrNames = Object.keys(newAttributes)
	const hasAnyAttributes = attrNames.length > 0

	return (
		<div
			data-cms-ui
			onMouseDown={(e) => e.stopPropagation()}
			onClick={(e) => e.stopPropagation()}
			class="right-8 top-8 bottom-8 fixed text-xs w-80"
			style={{
				zIndex: Z_INDEX.MODAL,
				fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
			}}
		>
			<div class="bg-cms-dark border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] rounded-cms-lg flex flex-col h-full overflow-hidden">
				{/* Header */}
				<div class="flex items-center justify-between p-4 border-b border-white/10">
					<div class="flex items-center gap-2">
						<span class="font-medium text-white">Element Attributes</span>
						{dirtyCount > 0 && (
							<span class="px-2 py-0.5 text-xs font-medium bg-cms-primary/20 text-cms-primary rounded-full">
								{dirtyCount}
							</span>
						)}
					</div>
					<button
						type="button"
						onClick={handleClose}
						class="text-white/50 hover:text-white cursor-pointer p-1.5 hover:bg-white/10 rounded-full transition-colors"
						data-cms-ui
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>

				{/* Content */}
				<div class="flex-1 overflow-y-auto p-4">
					{!hasAnyAttributes
						? (
							<div class="flex flex-col items-center justify-center h-48 text-white/50">
								<svg class="w-12 h-12 mb-3 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
									/>
								</svg>
								<p class="text-sm">No editable attributes found.</p>
								<p class="text-xs text-white/40 mt-1">This element has no tracked attributes.</p>
							</div>
						)
						: (
							<div class="space-y-3">
								{attrNames.map((attrName, index) => (
									<div key={attrName}>
										{index > 0 && <div class="h-px bg-white/5 mb-3" />}
										<AttributeField
											attrName={attrName}
											currentAttr={newAttributes[attrName]}
											originalAttr={originalAttributes[attrName]}
											pages={pages}
											onUpdate={(value) => handleAttrUpdate(attrName, value)}
											onReset={() => handleAttrUpdate(attrName, originalAttributes[attrName]?.value ?? '')}
											onOpenMediaLibrary={handleOpenMediaLibrary}
										/>
									</div>
								))}
							</div>
						)}
				</div>
			</div>
		</div>
	)
}
