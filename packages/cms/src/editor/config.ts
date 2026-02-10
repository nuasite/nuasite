import type { CmsConfig } from './types'

export const DEFAULT_CONFIG: CmsConfig = {
	apiBase: '/_nua/cms',
	highlightColor: '#005AE0',
	debug: false,
}

export function getConfig(): CmsConfig {
	const userConfig = typeof window !== 'undefined' ? window.NuaCmsConfig || {} : {}
	return { ...DEFAULT_CONFIG, ...userConfig }
}
