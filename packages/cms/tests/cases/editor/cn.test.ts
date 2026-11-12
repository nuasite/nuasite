import { describe, expect, test } from 'bun:test'
import { cn } from '../../../src/editor/lib/cn.ts'

const toggle = (active: boolean, className: string) => active && className

describe('cn', () => {
	test('joins class strings', () => {
		expect(cn('px-2', 'rounded')).toBe('px-2 rounded')
	})

	test('drops falsy values from conditional classes', () => {
		expect(cn('base', toggle(false, 'bg-cms-primary'), null, undefined, '', 'text-white')).toBe('base text-white')
		expect(cn('base', toggle(true, 'bg-cms-primary'))).toBe('base bg-cms-primary')
	})

	test('flattens nested arrays', () => {
		expect(cn(['a', ['b', toggle(false, 'c')]], 'd')).toBe('a b d')
	})

	test('a later conflicting Tailwind class wins over an earlier one', () => {
		expect(cn('p-2 text-sm', 'p-4')).toBe('text-sm p-4')
		expect(cn('opacity-100', toggle(true, 'opacity-0'))).toBe('opacity-0')
	})
})
