/**
 * Assertion helpers for CMS marker tests.
 *
 * Provides semantic assertions for testing HTML marking, manifest entries,
 * components, and error conditions.
 *
 * Uses node-html-parser for reliable HTML assertions instead of regex.
 */

import { expect } from 'bun:test'
import { parse } from 'node-html-parser'
import type { ProcessHtmlResult } from '../../src/html-processor'

// ============================================================================
// HTML Parsing Helpers
// ============================================================================

/**
 * Parse HTML string into a queryable DOM tree.
 */
function parseHtml(html: string) {
	return parse(html, {
		lowerCaseTagName: false,
		comment: false,
	})
}

// ============================================================================
// Element Marking Assertions
// ============================================================================

/**
 * Assert that an element is marked with a CMS ID.
 *
 * @param result - ProcessHtml result
 * @param tag - Tag name to check (e.g., 'h1', 'p')
 * @param expectedId - Optional specific ID to expect
 *
 * @example
 * expectMarked(result, 'h1')
 * expectMarked(result, 'h1', 'cms-0')
 */
export function expectMarked(result: ProcessHtmlResult, tag: string, expectedId?: string): void {
	const root = parseHtml(result.html)
	const elements = root.querySelectorAll(tag)

	if (expectedId) {
		const found = elements.some((el) => el.getAttribute('data-cms-id') === expectedId)
		expect(found).toBe(true)
	} else {
		const found = elements.some((el) => el.hasAttribute('data-cms-id'))
		expect(found).toBe(true)
	}
}

/**
 * Assert that an element is NOT marked with a CMS ID.
 *
 * @param result - ProcessHtml result
 * @param tag - Tag name to check
 */
export function expectNotMarked(result: ProcessHtmlResult, tag: string): void {
	const root = parseHtml(result.html)
	const elements = root.querySelectorAll(tag)
	const anyMarked = elements.some((el) => el.hasAttribute('data-cms-id'))
	expect(anyMarked).toBe(false)
}

/**
 * Assert that multiple elements are marked with CMS IDs.
 *
 * @param result - ProcessHtml result
 * @param tags - Array of tag names to check
 */
export function expectAllMarked(result: ProcessHtmlResult, tags: string[]): void {
	for (const tag of tags) {
		expectMarked(result, tag)
	}
}

/**
 * Assert that multiple elements are NOT marked with CMS IDs.
 *
 * @param result - ProcessHtml result
 * @param tags - Array of tag names to check
 */
export function expectNoneMarked(result: ProcessHtmlResult, tags: string[]): void {
	for (const tag of tags) {
		expectNotMarked(result, tag)
	}
}

/**
 * Count occurrences of data-cms-id in the HTML.
 *
 * @param result - ProcessHtml result
 * @returns Number of marked elements
 */
export function countMarkedElements(result: ProcessHtmlResult): number {
	const root = parseHtml(result.html)
	return root.querySelectorAll('[data-cms-id]').length
}

// ============================================================================
// Manifest Entry Assertions
// ============================================================================

/**
 * Assert the number of manifest entries.
 *
 * @param result - ProcessHtml result
 * @param count - Expected entry count
 */
export function expectEntryCount(result: ProcessHtmlResult, count: number): void {
	expect(Object.keys(result.entries)).toHaveLength(count)
}

/**
 * Assert that there are no manifest entries.
 *
 * @param result - ProcessHtml result
 */
export function expectNoEntries(result: ProcessHtmlResult): void {
	expect(Object.keys(result.entries)).toHaveLength(0)
}

/**
 * Assert that a manifest entry exists with expected properties.
 *
 * @param result - ProcessHtml result
 * @param id - Entry ID
 * @param expected - Expected partial properties
 */
export function expectEntry(
	result: ProcessHtmlResult,
	id: string,
	expected: Partial<ProcessHtmlResult['entries'][string]>,
): void {
	expect(result.entries[id]).toBeDefined()
	expect(result.entries[id]).toMatchObject(expected)
}

/**
 * Assert entry has specific tag.
 *
 * @param result - ProcessHtml result
 * @param id - Entry ID
 * @param tag - Expected tag name
 */
export function expectEntryTag(result: ProcessHtmlResult, id: string, tag: string): void {
	expect(result.entries[id]).toBeDefined()
	expect(result.entries[id]?.tag).toBe(tag)
}

/**
 * Assert entry text matches.
 *
 * @param result - ProcessHtml result
 * @param id - Entry ID
 * @param text - Expected text content
 */
export function expectEntryText(result: ProcessHtmlResult, id: string, text: string): void {
	expect(result.entries[id]).toBeDefined()
	expect(result.entries[id]?.text).toBe(text)
}

/**
 * Get entry by tag name (first match).
 *
 * @param result - ProcessHtml result
 * @param tag - Tag name to find
 * @returns The first matching entry or undefined
 */
export function getEntryByTag(
	result: ProcessHtmlResult,
	tag: string,
): ProcessHtmlResult['entries'][string] | undefined {
	return Object.values(result.entries).find((e) => e.tag === tag)
}

// ============================================================================
// Component Assertions
// ============================================================================

/**
 * Assert the number of components.
 *
 * @param result - ProcessHtml result
 * @param count - Expected component count
 */
export function expectComponentCount(result: ProcessHtmlResult, count: number): void {
	expect(Object.keys(result.components)).toHaveLength(count)
}

/**
 * Assert that there are no components.
 *
 * @param result - ProcessHtml result
 */
export function expectNoComponents(result: ProcessHtmlResult): void {
	expect(Object.keys(result.components)).toHaveLength(0)
}

// ============================================================================
// Style Assertions
// ============================================================================

/**
 * Assert that an element has the styled attribute.
 *
 * @param result - ProcessHtml result
 */
export function expectStyled(result: ProcessHtmlResult): void {
	const root = parseHtml(result.html)
	const hasStyled = root.querySelectorAll('[data-cms-styled="true"]').length > 0
	expect(hasStyled).toBe(true)
}

/**
 * Assert that no element has the styled attribute.
 *
 * @param result - ProcessHtml result
 */
export function expectNotStyled(result: ProcessHtmlResult): void {
	expect(result.html).not.toContain('data-cms-styled')
}

// ============================================================================
// Error Assertions
// ============================================================================

/**
 * Assert that a function throws an error.
 *
 * @param fn - Function expected to throw
 * @param expectedMessage - Optional message or regex to match
 *
 * @example
 * expectThrows(() => parseInvalid(), 'Invalid syntax')
 * expectThrows(() => parseInvalid(), /invalid/i)
 */
export function expectThrows(fn: () => unknown, expectedMessage?: string | RegExp): void {
	let threw = false
	let error: unknown

	try {
		fn()
	} catch (e) {
		threw = true
		error = e
	}

	expect(threw).toBe(true)

	if (expectedMessage && error instanceof Error) {
		if (typeof expectedMessage === 'string') {
			expect(error.message).toContain(expectedMessage)
		} else {
			expect(error.message).toMatch(expectedMessage)
		}
	}
}

/**
 * Assert that a promise rejects with an error.
 *
 * @param promise - Promise expected to reject
 * @param expectedMessage - Optional message or regex to match
 *
 * @example
 * await expectRejects(fetchInvalid(), 'Network error')
 * await expectRejects(fetchInvalid(), /network/i)
 */
export async function expectRejects(
	promise: Promise<unknown>,
	expectedMessage?: string | RegExp,
): Promise<void> {
	let rejected = false
	let error: unknown

	try {
		await promise
	} catch (e) {
		rejected = true
		error = e
	}

	expect(rejected).toBe(true)

	if (expectedMessage && error instanceof Error) {
		if (typeof expectedMessage === 'string') {
			expect(error.message).toContain(expectedMessage)
		} else {
			expect(error.message).toMatch(expectedMessage)
		}
	}
}
