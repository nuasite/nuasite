/**
 * Test utilities for cms-marker package.
 *
 * This module re-exports all test utilities for convenient importing:
 *
 * @example
 * import {
 *   cmsDescribe,
 *   expectMarked,
 *   html,
 *   withTempDir,
 * } from '../utils'
 */

// ID Generation
export { createIdGenerator, type IdGenerator, sharedGenerator } from './id-generator'

// Options
export { createOptions, defaultProcessHtmlOptions, options } from './options'

// Test Context
export { cmsDescribe, createTestSuite, type TestContext } from './test-context'

// HTML Builders
export { html } from './html-builders'

// Assertions - Element Marking
export { countMarkedElements, expectAllMarked, expectMarked, expectNoneMarked, expectNotMarked } from './assertions'

// Assertions - Manifest Entries
export { expectEntry, expectEntryCount, expectEntryTag, expectEntryText, expectNoEntries, getEntryByTag } from './assertions'

// Assertions - Components
export { expectComponentCount, expectNoComponents } from './assertions'

// Assertions - Styles
export { expectNotStyled, expectStyled } from './assertions'

// Assertions - Errors
export { expectRejects, expectThrows } from './assertions'

// Temp Directory
export {
	cleanupTempDir,
	createTempDir,
	setupAstroProjectStructure,
	setupContentCollections,
	type TempDirContext,
	withTempDir,
	type WithTempDirOptions,
} from './temp-directory'

// Cache Helpers
export { clearAllCaches, setupCacheReset, withCacheReset } from './cache-helper'

// Mock Factories
export {
	createMockComponentDefinition,
	createMockComponentDefinitions,
	createMockManifestWriter,
	createMockViteContext,
	defaultMockConfig,
	emptyManifest,
	type VitePluginContext,
} from './mocks'

// Test Data Factories
export {
	createAvailableColors,
	// Collection entries
	createCollectionEntry,
	createCollectionManifestEntry,
	createColorClasses,
	// Component instances
	createComponentInstance,
	createComponentInstances,
	createImageEntry,
	createManifestEntries,
	// Manifest entries
	createManifestEntry,
	createPageManifest,
	// Color configuration
	createTailwindColor,
	// Composite factories
	resetAllCounters,
	resetComponentCounter,
	resetEntryCounter,
} from './test-data'
