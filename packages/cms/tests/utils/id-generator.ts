/**
 * ID Generator utilities for CMS marker tests.
 *
 * Provides deterministic ID generation with reset capability for testing.
 *
 * @example
 * const generator = createIdGenerator('test')
 * generator.getNextId() // 'test-0'
 * generator.getNextId() // 'test-1'
 * generator.reset()
 * generator.getNextId() // 'test-0'
 */

export interface IdGenerator {
	/** Get the next sequential ID */
	getNextId: () => string
	/** Reset the counter to 0 */
	reset: () => void
	/** Get the current counter value */
	getCount: () => number
}

/**
 * Creates an ID generator for tests.
 * Returns an object with getNextId, reset, and getCount methods.
 *
 * @param prefix - The prefix for generated IDs (default: 'cms')
 */
export function createIdGenerator(prefix = 'cms'): IdGenerator {
	let counter = 0
	return {
		getNextId: () => `${prefix}-${counter++}`,
		reset: () => {
			counter = 0
		},
		getCount: () => counter,
	}
}

/** Shared generator instance for test helpers */
export const sharedGenerator = createIdGenerator()
