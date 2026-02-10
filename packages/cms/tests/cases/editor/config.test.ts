import { afterEach, beforeEach, expect, test } from 'bun:test'
import { DEFAULT_CONFIG, getConfig } from '../../../src/editor/config'

beforeEach(() => {
	// Clear any window config
	if (typeof window !== 'undefined') {
		delete (window as any).NuaCmsConfig
	}
})

afterEach(() => {
	if (typeof window !== 'undefined') {
		delete (window as any).NuaCmsConfig
	}
})

test('DEFAULT_CONFIG has expected values', () => {
	expect(DEFAULT_CONFIG.apiBase).toBe('/_nua/cms')
	expect(DEFAULT_CONFIG.highlightColor).toBe('#005AE0')
	expect(DEFAULT_CONFIG.debug).toBe(false)
})

test('getConfig returns default config when no user config', () => {
	const config = getConfig()
	expect(config).toEqual(DEFAULT_CONFIG)
})

test('getConfig merges user config with defaults', () => {
	if (typeof window !== 'undefined') {
		window.NuaCmsConfig = {
			apiBase: '/custom-api',
			highlightColor: '#ff0000',
		}
	}

	const config = getConfig()
	expect(config.apiBase).toBe('/custom-api')
	expect(config.highlightColor).toBe('#ff0000')
	expect(config.debug).toBe(false) // default
})

test('getConfig user config overrides all defaults', () => {
	if (typeof window !== 'undefined') {
		window.NuaCmsConfig = {
			apiBase: '/api',
			highlightColor: '#00ff00',
			debug: false,
		}
	}

	const config = getConfig()
	expect(config.apiBase).toBe('/api')
	expect(config.highlightColor).toBe('#00ff00')
	expect(config.debug).toBe(false)
})

test('getConfig handles partial user config', () => {
	if (typeof window !== 'undefined') {
		window.NuaCmsConfig = {
			debug: false,
		}
	}

	const config = getConfig()
	expect(config.apiBase).toBe('/_nua/cms')
	expect(config.highlightColor).toBe('#005AE0')
	expect(config.debug).toBe(false)
})

test('getConfig preserves type safety', () => {
	if (typeof window !== 'undefined') {
		window.NuaCmsConfig = {
			apiBase: '/test',
		}
	}

	const config = getConfig()

	// These should all be defined with correct types
	const _apiBase: string = config.apiBase
	const _highlightColor: string = config.highlightColor
	const _debug: boolean = config.debug

	expect(typeof config.apiBase).toBe('string')
	expect(typeof config.highlightColor).toBe('string')
	expect(typeof config.debug).toBe('boolean')
})
