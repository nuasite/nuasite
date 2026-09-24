import { describe, expect, test } from 'bun:test'
import { SharedRun } from '../src/concurrency'

describe('SharedRun', () => {
	test('callers that ask while a run is in flight get that run; a later caller starts a new one', async () => {
		let runs = 0
		const shared = new SharedRun(async () => ++runs)

		expect(await Promise.all([shared.get(), shared.get()])).toEqual([1, 1])
		expect(await shared.get()).toBe(2)
	})

	test('invalidate makes the next caller start a new run even while one is in flight', async () => {
		let runs = 0
		const shared = new SharedRun(async () => ++runs)

		const first = shared.get()
		shared.invalidate()

		expect(await Promise.all([first, shared.get()])).toEqual([1, 2])
	})

	test('a failed run is not handed to the next caller', async () => {
		let runs = 0
		const shared = new SharedRun(async () => {
			runs++
			if (runs === 1) throw new Error('scan failed')
			return runs
		})

		await expect(shared.get()).rejects.toThrow('scan failed')
		expect(await shared.get()).toBe(2)
	})
})
