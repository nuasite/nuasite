/**
 * Global configuration for cms-marker.
 * This allows overriding the project root for testing.
 */

let projectRootOverride: string | null = null

/**
 * Get the current project root directory.
 * Returns the override if set, otherwise process.cwd().
 */
export function getProjectRoot(): string {
	return projectRootOverride ?? process.cwd()
}

/**
 * Set the project root directory override.
 * Call this to use a specific directory instead of process.cwd().
 */
export function setProjectRoot(root: string): void {
	projectRootOverride = root
}

/**
 * Reset the project root to use process.cwd() again.
 */
export function resetProjectRoot(): void {
	projectRootOverride = null
}
