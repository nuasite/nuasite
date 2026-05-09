import { createHash } from 'node:crypto'

export type AstroComponentFactory = (...args: any[]) => any

export interface FragmentEntry {
	hash: string
	component: AstroComponentFactory
	props: Record<string, unknown>
	moduleId: string
	usedBy: Set<string>
}

const REGISTRY_KEY = '__nuasite_astro_fragments_registry__'

interface RegistryState {
	entries: Map<string, FragmentEntry>
	enabled: boolean
	projectRoot: string | null
}

function getState(): RegistryState {
	const g = globalThis as any
	if (!g[REGISTRY_KEY]) {
		g[REGISTRY_KEY] = {
			entries: new Map(),
			enabled: false,
			projectRoot: null,
		} satisfies RegistryState
	}
	return g[REGISTRY_KEY]
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

export function computeFragmentHash(moduleId: string, props: Record<string, unknown>, projectRoot: string | null): string {
	const normalizedModuleId = projectRoot && moduleId.startsWith(projectRoot)
		? moduleId.slice(projectRoot.length).replace(/^\/+/, '')
		: moduleId
	const sortedKeys = Object.keys(props).sort()
	const propsJson = JSON.stringify(props, sortedKeys)
	return createHash('sha1').update(`${normalizedModuleId}::${propsJson}`).digest('hex').slice(0, 12)
}

export function validateProps(props: Record<string, unknown>, componentLabel: string): void {
	for (const [key, value] of Object.entries(props)) {
		assertSerializable(value, `${componentLabel}.${key}`)
	}
}

function assertSerializable(value: unknown, path: string, seen: WeakSet<object> = new WeakSet()): void {
	if (value === null || value === undefined) return
	const t = typeof value
	if (t === 'string' || t === 'number' || t === 'boolean') return
	if (t === 'bigint') {
		throw new FragmentPropsError(`Fragment prop ${path} is a bigint, which is not JSON-serializable. Convert to a string before passing.`)
	}
	if (t === 'function') {
		throw new FragmentPropsError(`Fragment prop ${path} is a function. Fragment props must be plain serializable values.`)
	}
	if (t === 'symbol') {
		throw new FragmentPropsError(`Fragment prop ${path} is a symbol. Fragment props must be plain serializable values.`)
	}
	if (t !== 'object') {
		throw new FragmentPropsError(`Fragment prop ${path} has unsupported type ${t}.`)
	}
	if (seen.has(value as object)) {
		throw new FragmentPropsError(`Fragment prop ${path} contains a circular reference.`)
	}
	seen.add(value as object)
	if (value instanceof Date) {
		throw new FragmentPropsError(`Fragment prop ${path} is a Date instance. Convert to ISO string before passing.`)
	}
	if (value instanceof Map || value instanceof Set) {
		throw new FragmentPropsError(`Fragment prop ${path} is a ${value.constructor.name}. Convert to a plain array/object before passing.`)
	}
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			assertSerializable(value[i], `${path}[${i}]`, seen)
		}
		return
	}
	const proto = Object.getPrototypeOf(value)
	if (proto !== Object.prototype && proto !== null) {
		throw new FragmentPropsError(
			`Fragment prop ${path} is an instance of ${proto?.constructor?.name ?? 'unknown class'}. Only plain objects are supported.`,
		)
	}
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		assertSerializable(v, `${path}.${k}`, seen)
	}
}

export class FragmentPropsError extends Error {
	override name = 'FragmentPropsError'
}

export class FragmentRegistrationError extends Error {
	override name = 'FragmentRegistrationError'
}

export interface RegisterParams {
	component: AstroComponentFactory
	moduleId: string
	props: Record<string, unknown>
	pageUrl?: string
}

export function registerFragment(params: RegisterParams): string {
	const state = getState()
	if (!state.enabled) {
		throw new FragmentRegistrationError(
			'Fragment registry is not enabled. Make sure the @nuasite/astro-fragments integration is added to astro.config integrations[].',
		)
	}
	const hash = computeFragmentHash(params.moduleId, params.props, state.projectRoot)
	const existing = state.entries.get(hash)
	if (existing) {
		if (existing.component !== params.component) {
			throw new FragmentRegistrationError(
				`Hash collision: two different components produced the same fragment id "${hash}". Existing: ${existing.moduleId}, new: ${params.moduleId}.`,
			)
		}
		if (params.pageUrl) existing.usedBy.add(params.pageUrl)
		return hash
	}
	const entry: FragmentEntry = {
		hash,
		component: params.component,
		props: params.props,
		moduleId: params.moduleId,
		usedBy: new Set(),
	}
	if (params.pageUrl) entry.usedBy.add(params.pageUrl)
	state.entries.set(hash, entry)
	return hash
}

export function getFragments(): FragmentEntry[] {
	return [...getState().entries.values()]
}

export function getProjectRoot(): string | null {
	return getState().projectRoot
}
