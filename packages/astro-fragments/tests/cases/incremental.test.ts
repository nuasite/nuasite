import { afterEach, describe, expect, it } from 'bun:test'
import {
	disableRegistry,
	enableRegistry,
	FragmentRegistrationError,
	getFragments,
	registerFragment,
	runInRenderPass,
} from '../../src/registry.ts'

const PROJECT_ROOT = '/var/project/'

afterEach(() => {
	disableRegistry()
})

describe('registerFragment with lazy component', () => {
	it('accepts a registration without a component (replay path)', () => {
		enableRegistry(PROJECT_ROOT)
		const hash = registerFragment({ moduleId: 'src/foo.astro', props: { a: 1 } })
		expect(hash).toMatch(/^[a-f0-9]{12}$/)
		const [entry] = getFragments()
		expect(entry?.component).toBeUndefined()
		expect(entry?.moduleId).toBe('src/foo.astro')
	})

	it('upgrades a lazy entry when a real component shows up later', () => {
		enableRegistry(PROJECT_ROOT)
		const lazyHash = registerFragment({ moduleId: 'src/foo.astro', props: { a: 1 } })
		const component = (() => {}) as any
		const realHash = registerFragment({ component, moduleId: 'src/foo.astro', props: { a: 1 } })
		expect(lazyHash).toBe(realHash)
		const [entry] = getFragments()
		expect(entry?.component).toBe(component)
	})

	it('does not enforce collision check when one side has no component', () => {
		enableRegistry(PROJECT_ROOT)
		const componentA = (() => {}) as any
		registerFragment({ component: componentA, moduleId: 'src/foo.astro', props: { a: 1 } })
		// Replaying with no component fn must not throw even though the
		// hash already exists — moduleId+props identity is what matters.
		expect(() =>
			registerFragment({ moduleId: 'src/foo.astro', props: { a: 1 } }),
		).not.toThrow()
	})

	it('still enforces collision when two real components disagree', () => {
		enableRegistry(PROJECT_ROOT)
		const componentA = (() => {}) as any
		const componentB = (() => {}) as any
		registerFragment({ component: componentA, moduleId: 'src/foo.astro', props: { a: 1 } })
		expect(() =>
			registerFragment({ component: componentB, moduleId: 'src/foo.astro', props: { a: 1 } }),
		).toThrow(/collision/)
	})

	it('throws as before when the registry is not enabled', () => {
		expect(() =>
			registerFragment({ moduleId: 'src/foo.astro', props: { a: 1 } }),
		).toThrow(FragmentRegistrationError)
	})
})

describe('runInRenderPass', () => {
	it('returns the list of fragment hashes registered inside the scope', async () => {
		enableRegistry(PROJECT_ROOT)
		const { value, fragmentIds } = await runInRenderPass('page-1', async () => {
			registerFragment({ moduleId: 'src/A.astro', props: {} })
			registerFragment({ moduleId: 'src/B.astro', props: { x: 1 } })
			return 'ok'
		})
		expect(value).toBe('ok')
		expect(fragmentIds.length).toBe(2)
		expect(fragmentIds.every(h => /^[a-f0-9]{12}$/.test(h))).toBe(true)
	})

	it('deduplicates within a pass when the same fragment is registered twice', async () => {
		enableRegistry(PROJECT_ROOT)
		const { fragmentIds } = await runInRenderPass('page-1', async () => {
			registerFragment({ moduleId: 'src/A.astro', props: {} })
			registerFragment({ moduleId: 'src/A.astro', props: {} })
		})
		expect(fragmentIds.length).toBe(1)
	})

	it('isolates concurrent passes so they only see their own registrations', async () => {
		enableRegistry(PROJECT_ROOT)
		const [a, b] = await Promise.all([
			runInRenderPass('page-A', async () => {
				registerFragment({ moduleId: 'src/A.astro', props: {} })
				// Yield to make sure both passes are interleaved.
				await Promise.resolve()
				registerFragment({ moduleId: 'src/Shared.astro', props: {} })
			}),
			runInRenderPass('page-B', async () => {
				await Promise.resolve()
				registerFragment({ moduleId: 'src/B.astro', props: {} })
				registerFragment({ moduleId: 'src/Shared.astro', props: {} })
			}),
		])
		// Each pass sees exactly the fragments touched inside its async
		// scope — including the shared one (registered once globally,
		// but reported in both passes' lists).
		expect(a.fragmentIds.length).toBe(2)
		expect(b.fragmentIds.length).toBe(2)
		// And the registry overall holds three unique fragments.
		expect(getFragments().length).toBe(3)
	})

	it('records hashes for already-registered fragments touched within the scope', async () => {
		enableRegistry(PROJECT_ROOT)
		// Pre-register outside any pass (mimicking eager replay before
		// page renders begin).
		const hash = registerFragment({ moduleId: 'src/A.astro', props: {} })
		const { fragmentIds } = await runInRenderPass('page-1', async () => {
			registerFragment({ moduleId: 'src/A.astro', props: {} })
		})
		expect(fragmentIds).toEqual([hash])
	})
})
