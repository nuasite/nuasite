import { describe, expect, test } from 'bun:test'
import { forEachYielding, runYieldingToHost } from '../../src/project/host-yield'

/** Runs a pass over `count` items and records where a timer set before it fires among them. */
async function passWithTimer(count: number, pass: (run: () => Promise<void>) => Promise<void>): Promise<string[]> {
	const log: string[] = []
	setTimeout(() => log.push('turn'), 0)
	await pass(() => forEachYielding(Array.from({ length: count }, (_, index) => index), async () => void log.push('item')))
	await new Promise(resolve => setTimeout(resolve, 0))
	return log
}

describe('forEachYielding', () => {
	test('inside runYieldingToHost, gives the event loop a turn after every 50 items', async () => {
		const log = await passWithTimer(120, run => runYieldingToHost(run))

		expect(log.indexOf('turn')).toBe(50)
		expect(log.filter(entry => entry === 'item')).toHaveLength(120)
	})

	test('outside it, runs every item before the event loop gets a turn', async () => {
		const log = await passWithTimer(120, run => run())

		expect(log.indexOf('turn')).toBe(120)
	})
})
