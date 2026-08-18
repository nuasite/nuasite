import type { FieldDefinition, MutationResult } from '@nuasite/cms-types'
import { describe, expect, test } from 'bun:test'
import { type CmsClient, CmsClientError, type CmsConflict, type UpdateEntryInput, type UpdateEntryResult } from '../src/client'
import { createEntrySaver } from '../src/entry-saver'
import type { EntryDraft } from '../src/form-model'

const draft = (title: string): EntryDraft => ({ frontmatter: { title }, body: 'body' })

const ok = (sourceHash?: string): UpdateEntryResult => ({ status: 'ok', result: { success: true, sourceHash } satisfies MutationResult })

const conflictWith = (serverHash: string): CmsConflict => ({
	code: 'conflict',
	serverHash,
	serverFrontmatter: { title: 'theirs' },
	serverBody: 'their body',
})

/** A patcher answering from a scripted queue, recording every input it was called with. */
function patcher(outcomes: (UpdateEntryResult | Error)[]): Pick<CmsClient, 'updateEntry'> & { calls: UpdateEntryInput[] } {
	const calls: UpdateEntryInput[] = []
	let i = 0
	return {
		calls,
		updateEntry: (_collection, _slug, input) => {
			calls.push(input)
			const next = outcomes[i++]
			if (!next) throw new Error(`Unexpected save #${i}`)
			return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
		},
	}
}

describe('createEntrySaver', () => {
	test('the first save carries no token — GET exposes no hash, so the sidecar skips the check', async () => {
		const client = patcher([ok('h1')])
		const saver = createEntrySaver(client, 'articles', 'hello')

		expect(await saver.save(draft('mine'))).toEqual({ status: 'saved', result: { success: true, sourceHash: 'h1' } })
		expect(client.calls[0]).toEqual({ frontmatter: { title: 'mine' }, body: 'body', baseHash: undefined })
	})

	test('each successful save adopts the hash the next one is checked against', async () => {
		const client = patcher([ok('h1'), ok('h2'), ok('h3')])
		const saver = createEntrySaver(client, 'articles', 'hello')

		await saver.save(draft('one'))
		await saver.save(draft('two'))
		await saver.save(draft('three'))

		expect(client.calls.map(c => c.baseHash)).toEqual([undefined, 'h1', 'h2'])
		expect(saver.baseHash).toBe('h3')
	})

	test('a save answered with no hash keeps the previous token, rather than force-writing next time', async () => {
		const client = patcher([ok('h1'), ok(undefined), ok('h3')])
		const saver = createEntrySaver(client, 'articles', 'hello')

		await saver.save(draft('one'))
		await saver.save(draft('two'))
		await saver.save(draft('three'))

		expect(client.calls.map(c => c.baseHash)).toEqual([undefined, 'h1', 'h1'])
	})

	test('a conflict is an outcome, not a throw — the editor has a dialog for it', async () => {
		const conflict = conflictWith('server-hash')
		const client = patcher([{ status: 'conflict', conflict }])
		const saver = createEntrySaver(client, 'articles', 'hello')

		expect(await saver.save(draft('mine'))).toEqual({ status: 'conflict', conflict })
		// The losing attempt must not adopt anything: the next plain save still sends the old token.
		expect(saver.baseHash).toBeUndefined()
	})

	test('adopting the server version takes on its hash, so the next save is checked against it', async () => {
		const client = patcher([{ status: 'conflict', conflict: conflictWith('server-hash') }, ok('h2')])
		const saver = createEntrySaver(client, 'articles', 'hello')
		const fields: FieldDefinition[] = [{ name: 'title', type: 'text', required: true }]

		const outcome = await saver.save(draft('mine'))
		if (outcome.status !== 'conflict') throw new Error('expected a conflict')

		const adopted = saver.adoptServer(outcome.conflict, fields)
		expect(adopted).toEqual({ frontmatter: { title: 'theirs' }, body: 'their body' })
		expect(saver.baseHash).toBe('server-hash')

		await saver.save(draft('later'))
		expect(client.calls[1]?.baseHash).toBe('server-hash')
	})

	test('keeping mine force-writes over the server hash and then adopts the new one', async () => {
		const client = patcher([{ status: 'conflict', conflict: conflictWith('server-hash') }, ok('h2'), ok('h3')])
		const saver = createEntrySaver(client, 'articles', 'hello')

		const outcome = await saver.save(draft('mine'))
		if (outcome.status !== 'conflict') throw new Error('expected a conflict')

		expect(await saver.overwrite(draft('mine'), outcome.conflict)).toEqual({ status: 'saved', result: { success: true, sourceHash: 'h2' } })
		expect(client.calls[1]?.baseHash).toBe('server-hash')

		await saver.save(draft('after'))
		expect(client.calls[2]?.baseHash).toBe('h2')
	})

	test('a failed request surfaces the sidecar message, ready to show', async () => {
		const client = patcher([new CmsClientError(403, 'forbidden', 'No access to this project')])
		const saver = createEntrySaver(client, 'articles', 'hello')

		const outcome = await saver.save(draft('mine'))
		expect(outcome).toMatchObject({ status: 'error', message: 'No access to this project' })
	})

	test('a non-client failure gets a generic message but keeps the cause', async () => {
		const cause = new TypeError('Failed to fetch')
		const client = patcher([cause])
		const saver = createEntrySaver(client, 'articles', 'hello')

		expect(await saver.save(draft('mine'))).toEqual({ status: 'error', message: 'Save failed', cause })
	})

	test('reset forgets the token — the editor moved to another entry', async () => {
		const client = patcher([ok('h1'), ok('h2')])
		const saver = createEntrySaver(client, 'articles', 'hello')

		await saver.save(draft('one'))
		saver.reset()
		expect(saver.baseHash).toBeUndefined()

		await saver.save(draft('two'))
		expect(client.calls[1]?.baseHash).toBeUndefined()
	})
})
