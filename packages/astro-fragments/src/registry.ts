import type { AstroComponentFactory } from 'astro/runtime/server/index.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import path from 'node:path'

export type { AstroComponentFactory }

export interface FragmentEntry {
	hash: string
	/**
	 * Missing when an incremental host replays a cached registration without
	 * importing the page; the integration then imports `moduleId` itself.
	 */
	component?: AstroComponentFactory
	props: Record<string, unknown>
	/** Project-relative, POSIX separators. */
	moduleId: string
}

interface RenderPassState {
	pageId: string
	fragmentIds: Set<string>
}

interface RegistryState {
	entries: Map<string, FragmentEntry>
	enabled: boolean
	projectRoot: string | null
	renderPass: AsyncLocalStorage<RenderPassState>
}

declare global {
	// The integration (loaded by the host from the package root) and Fragment.astro
	// (compiled by Vite or the host's renderer) can get separate copies of this
	// module, so everything they share lives on one global.
	var __nuasite_astro_fragments_registry__: RegistryState | undefined
}

function getState(): RegistryState {
	globalThis.__nuasite_astro_fragments_registry__ ??= {
		entries: new Map(),
		enabled: false,
		projectRoot: null,
		renderPass: new AsyncLocalStorage(),
	}
	return globalThis.__nuasite_astro_fragments_registry__
}

export function enableRegistry(projectRoot: string): void {
	const state = getState()
	state.enabled = true
	state.projectRoot = projectRoot
	state.entries.clear()
}

export function disableRegistry(): void {
	const state = getState()
	state.enabled = false
	state.entries.clear()
}

export function isRegistryEnabled(): boolean {
	return getState().enabled
}

/** Makes an absolute module id project-relative with POSIX separators, so ids and caches don't depend on the checkout path. */
export function normalizeModuleId(moduleId: string, projectRoot: string | null): string {
	if (!projectRoot || !path.isAbsolute(moduleId)) return moduleId
	return path.relative(projectRoot, moduleId).split(path.sep).join('/')
}

export function computeFragmentHash(moduleId: string, props: Record<string, unknown>, projectRoot: string | null): string {
	const normalizedModuleId = normalizeModuleId(moduleId, projectRoot)
	return createHash('sha1').update(`${normalizedModuleId}::${canonicalJson(props)}`).digest('hex').slice(0, 12)
}

/** JSON with object keys sorted at every depth, so equal props always produce the same string. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(item => canonicalJson(item ?? null)).join(',')}]`
	}
	if (value !== null && typeof value === 'object') {
		const fields = Object.entries(value)
			.filter(([, inner]) => inner !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`)
		return `{${fields.join(',')}}`
	}
	return JSON.stringify(value)
}

export function validateProps(props: Record<string, unknown>, componentLabel: string): void {
	for (const [key, value] of Object.entries(props)) {
		assertSerializable(value, `${componentLabel}.${key}`, new Set())
	}
}

function assertSerializable(value: unknown, path: string, ancestors: Set<object>): void {
	if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new FragmentPropsError(`Fragment prop ${path} is ${value}, which JSON cannot represent.`)
		}
		return
	}
	if (typeof value === 'bigint') {
		throw new FragmentPropsError(`Fragment prop ${path} is a bigint, which is not JSON-serializable. Convert to a string before passing.`)
	}
	if (typeof value === 'function' || typeof value === 'symbol') {
		throw new FragmentPropsError(`Fragment prop ${path} is a ${typeof value}. Fragment props must be plain serializable values.`)
	}
	if (ancestors.has(value)) {
		throw new FragmentPropsError(`Fragment prop ${path} contains a circular reference.`)
	}
	if (value instanceof Date) {
		throw new FragmentPropsError(`Fragment prop ${path} is a Date instance. Convert to ISO string before passing.`)
	}
	if (value instanceof Map || value instanceof Set) {
		throw new FragmentPropsError(`Fragment prop ${path} is a ${value.constructor.name}. Convert to a plain array/object before passing.`)
	}
	ancestors.add(value)
	if (Array.isArray(value)) {
		value.forEach((item, index) => assertSerializable(item, `${path}[${index}]`, ancestors))
	} else {
		const proto = Reflect.getPrototypeOf(value)
		if (proto !== Object.prototype && proto !== null) {
			const className = typeof value.constructor === 'function' && value.constructor.name ? value.constructor.name : 'unknown class'
			throw new FragmentPropsError(`Fragment prop ${path} is an instance of ${className}. Only plain objects are supported.`)
		}
		for (const [key, inner] of Object.entries(value)) {
			assertSerializable(inner, `${path}.${key}`, ancestors)
		}
	}
	// Only ancestors make a cycle; the same object under two siblings is fine.
	ancestors.delete(value)
}

export class FragmentPropsError extends Error {
	override name = 'FragmentPropsError'
}

export class FragmentRegistrationError extends Error {
	override name = 'FragmentRegistrationError'
}

export interface RegisterParams {
	/** Omit when replaying a cached registration; the integration imports `moduleId` when it renders the fragment. */
	component?: AstroComponentFactory
	/** Absolute, or relative to the project root. */
	moduleId: string
	props: Record<string, unknown>
}

export function registerFragment(params: RegisterParams): string {
	const state = getState()
	if (!state.enabled) {
		throw new FragmentRegistrationError(
			'Fragment registry is not enabled. Make sure the @nuasite/astro-fragments integration is added to astro.config integrations[].',
		)
	}
	const moduleId = normalizeModuleId(params.moduleId, state.projectRoot)
	const hash = computeFragmentHash(moduleId, params.props, null)
	const existing = state.entries.get(hash)
	if (existing) {
		// Only two concrete factories can be compared; a replayed entry is identified by moduleId + props, which the hash covers.
		if (existing.component && params.component && existing.component !== params.component) {
			throw new FragmentRegistrationError(
				`Hash collision: two different components produced the same fragment id "${hash}". Existing: ${existing.moduleId}, new: ${moduleId}.`,
			)
		}
		existing.component ??= params.component
	} else {
		state.entries.set(hash, { hash, component: params.component, props: params.props, moduleId })
	}
	state.renderPass.getStore()?.fragmentIds.add(hash)
	return hash
}

export function getFragments(): FragmentEntry[] {
	return [...getState().entries.values()]
}

export function getProjectRoot(): string | null {
	return getState().projectRoot
}

export interface RenderPassResult<T> {
	value: T
	fragmentIds: string[]
}

/**
 * Runs a page render and returns the ids of the fragments it registered, so an
 * incremental host can cache them and replay them with `registerFragment` when it
 * skips the page next time. The bundled component registers on every render, so
 * the list is complete.
 */
export async function runInRenderPass<T>(pageId: string, fn: () => T | Promise<T>): Promise<RenderPassResult<T>> {
	const fragmentIds = new Set<string>()
	const value = await getState().renderPass.run({ pageId, fragmentIds }, fn)
	return { value, fragmentIds: [...fragmentIds] }
}
