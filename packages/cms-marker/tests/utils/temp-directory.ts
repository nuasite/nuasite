/**
 * Temporary directory utilities for integration tests.
 *
 * Provides helpers for creating isolated test environments with
 * automatic cleanup and standard project structure setup.
 *
 * @example
 * withTempDir('My Integration Tests', (getCtx) => {
 *   test('creates files correctly', async () => {
 *     const ctx = getCtx()
 *     await ctx.writeFile('src/test.astro', '<h1>Hello</h1>')
 *     // ... test code
 *   })
 * })
 */

import { afterEach, beforeEach, describe } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearSourceFinderCache } from '../../src/source-finder'
import { sharedGenerator } from './id-generator'
import { resetAllCounters } from './test-data'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Context object for temporary directory operations.
 */
export interface TempDirContext {
	/** Absolute path to the temporary directory */
	tempDir: string
	/** Original working directory (restored on cleanup) */
	originalCwd: string
	/** Write a file relative to the temp directory */
	writeFile: (relativePath: string, content: string) => Promise<void>
	/** Create a directory relative to the temp directory */
	mkdir: (relativePath: string) => Promise<void>
}

/**
 * Creates a temporary directory for tests and changes to it.
 * Returns context with helper functions for file operations.
 *
 * @param prefix - Prefix for the temp directory name
 * @returns TempDirContext with helpers
 *
 * @example
 * const ctx = await createTempDir('my-test-')
 * await ctx.writeFile('src/file.ts', 'content')
 * // ... run tests
 * await cleanupTempDir(ctx)
 */
export async function createTempDir(prefix = 'cms-test-'): Promise<TempDirContext> {
	// Create temp dir in the parent tests directory, not in utils
	const testsDir = path.dirname(__dirname)
	const tempDir = path.join(testsDir, `__${prefix}${Date.now()}__`)
	const originalCwd = process.cwd()

	await fs.mkdir(tempDir, { recursive: true })
	process.chdir(tempDir)

	return {
		tempDir,
		originalCwd,
		writeFile: async (relativePath: string, content: string) => {
			const fullPath = path.join(tempDir, relativePath)
			await fs.mkdir(path.dirname(fullPath), { recursive: true })
			await fs.writeFile(fullPath, content)
		},
		mkdir: async (relativePath: string) => {
			await fs.mkdir(path.join(tempDir, relativePath), { recursive: true })
		},
	}
}

/**
 * Cleans up temporary directory and restores original working directory.
 * Includes error handling to prevent silent failures.
 *
 * @param ctx - The TempDirContext to clean up
 */
export async function cleanupTempDir(ctx: TempDirContext): Promise<void> {
	try {
		// Always try to restore the original cwd first
		process.chdir(ctx.originalCwd)
	} catch (error) {
		console.error('[cleanupTempDir] Failed to restore working directory:', error)
	}

	try {
		await fs.rm(ctx.tempDir, { recursive: true, force: true })
	} catch (error) {
		console.error(`[cleanupTempDir] Failed to remove temp directory ${ctx.tempDir}:`, error)
	}
}

/**
 * Options for withTempDir.
 */
export interface WithTempDirOptions {
	/** Prefix for temp directory names (default: 'cms-test-') */
	prefix?: string
	/** Automatically clear caches before each test (default: true) */
	clearCaches?: boolean
	/** Automatically set up Astro project structure (default: false) */
	setupAstro?: boolean
}

/**
 * Creates a describe block with automatic temp directory setup/cleanup.
 * Each test gets a fresh temp directory that is cleaned up after the test.
 *
 * By default, also clears source finder caches before each test.
 *
 * @param name - Describe block name
 * @param fn - Test function receiving a getCtx function
 * @param options - Configuration options (or prefix string for backwards compat)
 *
 * @example
 * withTempDir('My Integration Tests', (getCtx) => {
 *   test('creates component file', async () => {
 *     const ctx = getCtx()
 *     await setupAstroProjectStructure(ctx)
 *     await ctx.writeFile('src/components/Test.astro', content)
 *     // ... assertions
 *   })
 * })
 *
 * @example
 * // With automatic Astro setup
 * withTempDir('Source Finder', (getCtx) => {
 *   test('finds source', async () => {
 *     const ctx = getCtx()
 *     // Astro directories already created, caches cleared
 *     await ctx.writeFile('src/components/Test.astro', content)
 *   })
 * }, { setupAstro: true })
 */
export function withTempDir(
	name: string,
	fn: (getCtx: () => TempDirContext) => void,
	options: WithTempDirOptions | string = {},
): void {
	// Support legacy string prefix argument
	const opts: WithTempDirOptions = typeof options === 'string'
		? { prefix: options }
		: options

	const {
		prefix = 'cms-test-',
		clearCaches = true,
		setupAstro = false,
	} = opts

	describe(name, () => {
		let ctx: TempDirContext

		beforeEach(async () => {
			// Clear caches before creating temp dir
			if (clearCaches) {
				clearSourceFinderCache()
				sharedGenerator.reset()
				resetAllCounters()
			}

			ctx = await createTempDir(prefix)

			// Optionally set up Astro project structure
			if (setupAstro) {
				await setupAstroProjectStructure(ctx)
			}
		})

		afterEach(async () => {
			if (ctx) {
				await cleanupTempDir(ctx)
			}
		})

		fn(() => ctx)
	})
}

/**
 * Helper to create standard Astro project structure in temp dir.
 *
 * Creates:
 * - src/components/
 * - src/pages/
 * - src/layouts/
 *
 * @param ctx - TempDirContext from createTempDir or withTempDir
 */
export async function setupAstroProjectStructure(ctx: TempDirContext): Promise<void> {
	await ctx.mkdir('src/components')
	await ctx.mkdir('src/pages')
	await ctx.mkdir('src/layouts')
}

/**
 * Helper to create standard content collection structure.
 *
 * @param ctx - TempDirContext from createTempDir or withTempDir
 * @param collections - Array of collection names to create (default: ['blog', 'services'])
 */
export async function setupContentCollections(
	ctx: TempDirContext,
	collections: string[] = ['blog', 'services'],
): Promise<void> {
	for (const collection of collections) {
		await ctx.mkdir(`src/content/${collection}`)
	}
}
