import { afterEach, describe, expect, it } from 'bun:test'
import {
	type AstroComponentFactory,
	computeFragmentHash,
	disableRegistry,
	enableRegistry,
	FragmentPropsError,
	FragmentRegistrationError,
	getFragments,
	parseFragmentTarget,
	registerFragment,
	validateProps,
} from '../../src/registry.ts'

const PROJECT_ROOT = '/var/project/'

/** A distinct component factory per call; registry tests only compare identities. */
const fakeComponent = (): AstroComponentFactory => () => new Response()

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

	it('is sensitive to nested prop values', () => {
		const a = computeFragmentHash('src/foo.astro', { filter: { tag: 'a' } }, PROJECT_ROOT)
		const b = computeFragmentHash('src/foo.astro', { filter: { tag: 'b' } }, PROJECT_ROOT)
		expect(a).not.toBe(b)
		const c = computeFragmentHash('src/foo.astro', { items: [{ id: 1 }] }, PROJECT_ROOT)
		const d = computeFragmentHash('src/foo.astro', { items: [{ id: 2 }] }, PROJECT_ROOT)
		expect(c).not.toBe(d)
	})

	it('hashes props the same after a JSON round trip, sparse arrays included', () => {
		const items: unknown[] = []
		items[1] = 1 // leaves a hole at index 0
		const props = { items, note: undefined, nested: { b: [undefined], a: -0 } }
		const roundTripped: Record<string, unknown> = JSON.parse(JSON.stringify(props))
		expect(computeFragmentHash('src/foo.astro', roundTripped, PROJECT_ROOT)).toBe(computeFragmentHash('src/foo.astro', props, PROJECT_ROOT))
	})

	it('is order-independent in nested props', () => {
		const a = computeFragmentHash('src/foo.astro', { filter: { tag: 'a', limit: 3 } }, PROJECT_ROOT)
		const b = computeFragmentHash('src/foo.astro', { filter: { limit: 3, tag: 'a' } }, PROJECT_ROOT)
		expect(a).toBe(b)
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
		const a: Record<string, unknown> = { x: 1 }
		a.self = a
		expect(() => validateProps({ a }, 'C')).toThrow(/circular/)
	})

	it('accepts the same object under two siblings', () => {
		const author = { name: 'Ada' }
		expect(() => validateProps({ posts: [{ author }, { author }] }, 'C')).not.toThrow()
	})

	it('rejects NaN and Infinity, which JSON turns into null', () => {
		expect(() => validateProps({ a: Number.NaN }, 'C')).toThrow(/C\.a is NaN/)
		expect(() => validateProps({ a: [Number.POSITIVE_INFINITY] }, 'C')).toThrow(/C\.a\[0\] is Infinity/)
	})
})

describe('parseFragmentTarget', () => {
	const component = Object.assign(fakeComponent(), { moduleId: '/var/project/src/fragments/Card.astro' })

	it('returns the component, its module id and the props', () => {
		expect(parseFragmentTarget(component, { slug: 'a' })).toEqual({
			component,
			moduleId: '/var/project/src/fragments/Card.astro',
			props: { slug: 'a' },
		})
	})

	it('defaults missing props to an empty object', () => {
		expect(parseFragmentTarget(component, undefined).props).toEqual({})
	})

	it('rejects an `of` that is not a component', () => {
		expect(() => parseFragmentTarget('Card', {})).toThrow(/requires an `of` prop/)
	})

	it('rejects a component without a moduleId', () => {
		expect(() => parseFragmentTarget(fakeComponent(), {})).toThrow(/without a moduleId/)
	})

	it('rejects props that are not a plain object', () => {
		expect(() => parseFragmentTarget(component, [1, 2])).toThrow(/`props` of Card.astro must be a plain object/)
		expect(() => parseFragmentTarget(component, 'x')).toThrow(FragmentPropsError)
	})

	it('validates the props', () => {
		expect(() => parseFragmentTarget(component, { when: new Date() })).toThrow(/Card\.astro\.when is a Date/)
	})
})

describe('registerFragment', () => {
	it('throws when registry is not enabled', () => {
		const component = fakeComponent()
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
		const component = fakeComponent()
		const h1 = registerFragment({ component, moduleId: 'src/foo.astro', props: { a: 1 } })
		const h2 = registerFragment({ component, moduleId: 'src/foo.astro', props: { a: 1 } })
		expect(h1).toBe(h2)
		expect(getFragments().length).toBe(1)
	})

	it('records distinct entries for different props', () => {
		enableRegistry(PROJECT_ROOT)
		const component = fakeComponent()
		registerFragment({ component, moduleId: 'src/foo.astro', props: { a: 1 } })
		registerFragment({ component, moduleId: 'src/foo.astro', props: { a: 2 } })
		expect(getFragments().length).toBe(2)
	})

	it('throws on hash collision with different components', () => {
		enableRegistry(PROJECT_ROOT)
		const componentA = fakeComponent()
		const componentB = fakeComponent()
		// Force collision by feeding same identity inputs but different components
		const props = { a: 1 }
		registerFragment({ component: componentA, moduleId: 'src/foo.astro', props })
		expect(() => registerFragment({ component: componentB, moduleId: 'src/foo.astro', props }))
			.toThrow(/collision/)
	})

	it('stores the module id relative to the project root', () => {
		enableRegistry('/var/project')
		const absolute = registerFragment({ component: fakeComponent(), moduleId: '/var/project/src/foo.astro', props: {} })
		const [entry] = getFragments()
		expect(entry?.moduleId).toBe('src/foo.astro')
		expect(registerFragment({ moduleId: 'src/foo.astro', props: {} })).toBe(absolute)
	})

	it('keeps components outside the project root relative, independent of the checkout path', () => {
		enableRegistry('/home/a/site')
		const first = registerFragment({ moduleId: '/home/a/shared/Card.astro', props: {} })
		expect(getFragments()[0]?.moduleId).toBe('../shared/Card.astro')
		enableRegistry('/srv/b/site')
		expect(registerFragment({ moduleId: '/srv/b/shared/Card.astro', props: {} })).toBe(first)
	})
})
