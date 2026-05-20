import { afterEach, describe, expect, it } from 'bun:test'
import {
	computeFragmentHash,
	disableRegistry,
	enableRegistry,
	FragmentPropsError,
	FragmentRegistrationError,
	getFragments,
	registerFragment,
	validateProps,
} from '../../src/registry.ts'

const PROJECT_ROOT = '/var/project/'

afterEach(() => {
	disableRegistry()
})

describe('computeFragmentHash', () => {
	it('produces a stable 12-char hex hash', () => {
		const hash = computeFragmentHash('src/foo.astro', { a: 1 }, PROJECT_ROOT)
		expect(hash).toMatch(/^[a-f0-9]{12}$/)
	})

	it('is deterministic across calls', () => {
		const a = computeFragmentHash('src/foo.astro', { a: 1, b: 2 }, PROJECT_ROOT)
		const b = computeFragmentHash('src/foo.astro', { a: 1, b: 2 }, PROJECT_ROOT)
		expect(a).toBe(b)
	})

	it('is order-independent in props', () => {
		const a = computeFragmentHash('src/foo.astro', { a: 1, b: 2 }, PROJECT_ROOT)
		const b = computeFragmentHash('src/foo.astro', { b: 2, a: 1 }, PROJECT_ROOT)
		expect(a).toBe(b)
	})

	it('is sensitive to prop values', () => {
		const a = computeFragmentHash('src/foo.astro', { a: 1 }, PROJECT_ROOT)
		const b = computeFragmentHash('src/foo.astro', { a: 2 }, PROJECT_ROOT)
		expect(a).not.toBe(b)
	})

	it('is sensitive to component path', () => {
		const a = computeFragmentHash('src/foo.astro', { a: 1 }, PROJECT_ROOT)
		const b = computeFragmentHash('src/bar.astro', { a: 1 }, PROJECT_ROOT)
		expect(a).not.toBe(b)
	})

	it('normalizes module id by stripping the project root prefix', () => {
		const absolute = computeFragmentHash('/var/project/src/foo.astro', { a: 1 }, PROJECT_ROOT)
		const relative = computeFragmentHash('src/foo.astro', { a: 1 }, PROJECT_ROOT)
		expect(absolute).toBe(relative)
	})
})

describe('validateProps', () => {
	it('accepts plain serializable values', () => {
		expect(() => validateProps({ a: 1, b: 'two', c: true, d: null, e: [1, 'two', { x: 3 }] }, 'C')).not.toThrow()
	})

	it('rejects bigint', () => {
		expect(() => validateProps({ a: 10n }, 'C')).toThrow(FragmentPropsError)
	})

	it('rejects functions', () => {
		expect(() => validateProps({ a: () => 1 }, 'C')).toThrow(/function/)
	})

	it('rejects Date', () => {
		expect(() => validateProps({ a: new Date() }, 'C')).toThrow(/Date/)
	})

	it('rejects Map / Set', () => {
		expect(() => validateProps({ a: new Map() }, 'C')).toThrow(/Map/)
		expect(() => validateProps({ a: new Set() }, 'C')).toThrow(/Set/)
	})

	it('rejects class instances', () => {
		class Foo {
			x = 1
		}
		expect(() => validateProps({ a: new Foo() }, 'C')).toThrow(/Foo/)
	})

	it('rejects circular references', () => {
		const a: any = { x: 1 }
		a.self = a
		expect(() => validateProps({ a }, 'C')).toThrow(/circular/)
	})
})

describe('registerFragment', () => {
	it('throws when registry is not enabled', () => {
		const component = {} as any
		expect(() =>
			registerFragment({
				component,
				moduleId: 'src/foo.astro',
				props: {},
			})
		).toThrow(FragmentRegistrationError)
	})

	it('registers and dedupes by hash', () => {
		enableRegistry(PROJECT_ROOT)
		const component = {} as any
		const h1 = registerFragment({ component, moduleId: 'src/foo.astro', props: { a: 1 } })
		const h2 = registerFragment({ component, moduleId: 'src/foo.astro', props: { a: 1 } })
		expect(h1).toBe(h2)
		expect(getFragments().length).toBe(1)
	})

	it('records distinct entries for different props', () => {
		enableRegistry(PROJECT_ROOT)
		const component = {} as any
		registerFragment({ component, moduleId: 'src/foo.astro', props: { a: 1 } })
		registerFragment({ component, moduleId: 'src/foo.astro', props: { a: 2 } })
		expect(getFragments().length).toBe(2)
	})

	it('throws on hash collision with different components', () => {
		enableRegistry(PROJECT_ROOT)
		const componentA = {} as any
		const componentB = {} as any
		// Force collision by feeding same identity inputs but different components
		const props = { a: 1 }
		registerFragment({ component: componentA, moduleId: 'src/foo.astro', props })
		expect(() => registerFragment({ component: componentB, moduleId: 'src/foo.astro', props }))
			.toThrow(/collision/)
	})

	it('aggregates usedBy', () => {
		enableRegistry(PROJECT_ROOT)
		const component = {} as any
		registerFragment({ component, moduleId: 'src/foo.astro', props: { a: 1 }, pageUrl: '/page-1' })
		registerFragment({ component, moduleId: 'src/foo.astro', props: { a: 1 }, pageUrl: '/page-2' })
		const [entry] = getFragments()
		expect([...(entry?.usedBy ?? [])].sort()).toEqual(['/page-1', '/page-2'])
	})
})
