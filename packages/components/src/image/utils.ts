import type { CloudflareImageTransformOptions } from './types'

export const optionKeyMap: Record<keyof CloudflareImageTransformOptions, string> = {
	anim: 'anim',
	background: 'background',
	blur: 'blur',
	border: 'border',
	brightness: 'brightness',
	compression: 'compression',
	contrast: 'contrast',
	dpr: 'dpr',
	fit: 'fit',
	flip: 'flip',
	format: 'format',
	gamma: 'gamma',
	gravity: 'gravity',
	height: 'height',
	metadata: 'metadata',
	onError: 'onerror',
	quality: 'quality',
	rotate: 'rotate',
	saturation: 'saturation',
	segment: 'segment',
	sharpen: 'sharpen',
	slowConnectionQuality: 'slow-connection-quality',
	trim: 'trim',
	trimBorderColor: 'trim.border.color',
	trimBorderTolerance: 'trim.border.tolerance',
	trimBorderKeep: 'trim.border.keep',
	trimWidth: 'trim.width',
	trimHeight: 'trim.height',
	trimLeft: 'trim.left',
	trimTop: 'trim.top',
	width: 'width',
	zoom: 'zoom',
}

export const serializeOptions = (options: CloudflareImageTransformOptions) =>
	Object.entries(options)
		.filter(([, value]) => value !== undefined && value !== null)
		.map(([rawKey, value]) => {
			const key = optionKeyMap[rawKey as keyof CloudflareImageTransformOptions] ?? rawKey
			const stringValue = typeof value === 'string'
				? value
				: typeof value === 'boolean'
				? String(value)
				: Number.isFinite(value)
				? String(value)
				: ''

			return stringValue ? `${key}=${encodeURIComponent(stringValue)}` : ''
		})
		.filter(Boolean)
		.join(',')
