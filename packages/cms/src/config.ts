/**
 * Global configuration for cms-marker.
 * This allows overriding the project root for testing.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

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

/**
 * Get the validation root for path traversal checks.
 * In a monorepo/workspace, this returns the workspace root so that
 * files in sibling packages are considered valid.
 * Falls back to getProjectRoot() when not in a workspace.
 */
let validationRootCache: string | undefined
export function getValidationRoot(): string {
	if (validationRootCache !== undefined) return validationRootCache
	const wsRoot = findWorkspaceRoot(getProjectRoot())
	validationRootCache = wsRoot ?? getProjectRoot()
	return validationRootCache
}

/**
 * Reset the cached validation root (call when project root changes).
 */
export function resetValidationRoot(): void {
	validationRootCache = undefined
}

/**
 * Walk up from startDir to find the nearest package.json with a "workspaces" field.
 * Returns the workspace root directory, or null if not found.
 */
function findWorkspaceRoot(startDir: string): string | null {
	let dir = path.resolve(startDir)
	while (true) {
		const pkgPath = path.join(dir, 'package.json')
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
				if (pkg.workspaces) return dir
			} catch {}
		}
		const parent = path.dirname(dir)
		if (parent === dir) break
		dir = parent
	}
	return null
}
