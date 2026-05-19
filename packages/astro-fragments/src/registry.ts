import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'

export type AstroComponentFactory = (...args: any[]) => any

export interface FragmentEntry {
	hash: string
	/**
	 * The component factory itself. Optional because hosts that implement
	 * incremental rebuilds (e.g. pletivo) replay registrations from a cache
	 * without re-importing the page module; in that case the integration
	 * resolves the factory lazily from `moduleId` only if it actually needs
	 * to re-render the fragment.
	 */
	component?: AstroComponentFactory
	props: Record<string, unknown>
	moduleId: string
	/**
	 * Pages that contain a `<Fragment>` referencing this entry. Populated
	 * from the `pageUrl` field of `registerFragment` calls. Replayed
	 * registrations from an incremental host typically don't carry
	 * `pageUrl` — for those, the integration recovers `usedBy` by
	 * scanning `<x-fragment id>` placeholders in dist/, so the final
	 * manifest is correct even though this in-memory Set may be empty.
	 */
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
	// Force a trailing `/` so prefix checks (`moduleId.startsWith(projectRoot)`)
	// can't false-match a sibling project whose root happens to share a
	// prefix — e.g. `/home/me/site` vs `/home/me/site-old/foo.astro`.
	state.projectRoot = projectRoot.endsWith('/') ? projectRoot : projectRoot + '/'
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
	/**
	 * The component factory. Optional — when omitted (e.g. a host replaying
	 * cached registrations on an incremental rebuild), the integration will
	 * lazy-import the factory from `moduleId` if and only if the fragment
	 * actually needs to be rendered.
	 */
	component?: AstroComponentFactory
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
		// Hash-collision sanity check — only enforceable when both sides
		// carry a concrete component fn. Replayed registrations (no fn)
		// rely on `moduleId`+`props` identity which the hash already covers.
		if (existing.component && params.component && existing.component !== params.component) {
			throw new FragmentRegistrationError(
				`Hash collision: two different components produced the same fragment id "${hash}". Existing: ${existing.moduleId}, new: ${params.moduleId}.`,
			)
		}
		// Upgrade a previously-lazy entry once a real component shows up,
		// so renderFragments can use it without doing an import().
		if (!existing.component && params.component) {
			existing.component = params.component
		}
		if (params.pageUrl) existing.usedBy.add(params.pageUrl)
		recordInRenderPass(hash)
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
	recordInRenderPass(hash)
	return hash
}

export function getFragments(): FragmentEntry[] {
	return [...getState().entries.values()]
}

export function getProjectRoot(): string | null {
	return getState().projectRoot
}

// ── Render-pass scope ───────────────────────────────────────────────
//
// Hosts that want per-page fragment lists (so they can persist them
// for incremental replay) wrap their page-render call in
// `runInRenderPass(pageId, fn)`. Every `registerFragment` invocation
// inside the async scope tags the resulting hash with the pass; the
// caller receives the deduplicated list of fragment ids alongside the
// render result.
//
// Load-bearing assumption: fragment components must call
// `registerFragment` on **every** render, even when the entry already
// exists in the registry (the call is cheap — it just bumps `usedBy`
// and re-records the pass). If a component short-circuits a re-render,
// its fragment will drop out of the per-page list and break replay on
// the next incremental build. The bundled `<Fragment>` Astro component
// follows this contract; custom hosts must match it.

interface RenderPassState {
	pageId: string
	fragmentIds: Set<string>
}

const renderPassStorage = new AsyncLocalStorage<RenderPassState>()

export interface RenderPassResult<T> {
	value: T
	fragmentIds: string[]
}

export async function runInRenderPass<T>(
	pageId: string,
	fn: () => T | Promise<T>,
): Promise<RenderPassResult<T>> {
	const fragmentIds = new Set<string>()
	const value = await renderPassStorage.run(
		{ pageId, fragmentIds },
		async () => fn(),
	)
	return { value, fragmentIds: [...fragmentIds] }
}

function recordInRenderPass(hash: string): void {
	const pass = renderPassStorage.getStore()
	if (pass) pass.fragmentIds.add(hash)
}
