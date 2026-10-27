import type { ProjectContext } from './context.ts'

// Where there is no Node filesystem (the `workerd` condition) there is no project at the working
// directory: every call runs inside a context a host entered with `runInProjectContext`.

export function setDefaultProjectRoot(_root: string | null): void {
	throw new Error('No default project here: create a project context and run inside it')
}

export function defaultProjectContext(): ProjectContext {
	throw new Error('No project context: run inside one entered with runInProjectContext')
}
