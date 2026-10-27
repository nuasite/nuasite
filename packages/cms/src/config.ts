/**
 * The project root of the code running now. In a host's project context it is that context's
 * root; otherwise the working directory, or the override set here (for tests and tools).
 */

import { setDefaultProjectRoot } from '#project-context-default'
import { currentProjectContext } from './project/context.ts'

export function getProjectRoot(): string {
	return currentProjectContext().root
}

/** Use `root` instead of the working directory when no project context is entered. */
export function setProjectRoot(root: string): void {
	setDefaultProjectRoot(root)
}

/** Use the working directory again. */
export function resetProjectRoot(): void {
	setDefaultProjectRoot(null)
}
