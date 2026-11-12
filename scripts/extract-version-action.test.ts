import { afterAll, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The publish workflow reads `npmTag` from this action, so a wrong value publishes a release under the wrong dist-tag.

const action = path.join(import.meta.dir, '..', '.github', 'actions', 'extract-version', 'index.mjs')
// Keeps the developer's git config (signing, hooks) and an inherited GIT_DIR away from the temp repo.
const gitEnv = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull }
const tempDirs: string[] = []

afterAll(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function withTags(tags: string[]): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-version-'))
	tempDirs.push(dir)
	const git = (...args: string[]) => {
		const result = spawnSync('git', args, { cwd: dir, encoding: 'utf-8', env: gitEnv })
		if (result.status !== 0) throw new Error(result.stderr)
	}
	git('init', '-q')
	git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init')
	for (const tag of tags) git('tag', tag)
	return dir
}

function run(cwd: string, env: Record<string, string>, { withOutputFile = true } = {}) {
	const output = path.join(cwd, 'github-output')
	fs.writeFileSync(output, '')
	const outputEnv = withOutputFile ? { GITHUB_OUTPUT: output } : {}
	const result = spawnSync('node', [action], { cwd, encoding: 'utf-8', env: { ...gitEnv, ...outputEnv, ...env } })
	return { status: result.status, stderr: result.stderr, outputs: parseOutputs(fs.readFileSync(output, 'utf-8')) }
}

// Reads both `name=value` lines and the `name<<DELIMITER` multiline form of $GITHUB_OUTPUT.
function parseOutputs(text: string): Record<string, string> {
	const outputs: Record<string, string> = {}
	const lines = text.split('\n')
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? ''
		const heredoc = line.match(/^([^=<]+)<<(.+)$/)
		if (heredoc?.[1] && heredoc[2]) {
			const end = lines.indexOf(heredoc[2], i + 1)
			outputs[heredoc[1]] = lines.slice(i + 1, end).join('\n')
			i = end
			continue
		}
		const eq = line.indexOf('=')
		if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1)
	}
	return outputs
}

describe('extract-version action', () => {
	test('the newest stable version gets the latest tag and all its aliases', () => {
		const cwd = withTags(['v0.66.0', 'v0.67.3', 'v0.67.4'])
		const { status, outputs } = run(cwd, { INPUT_VERSION: 'v0.67.4' })
		expect(status).toBe(0)
		expect(outputs).toEqual({ npmTag: 'latest', versions: '0.67.4 0.67 0' })
	})

	test('a patch to an older minor is published as bump', () => {
		const cwd = withTags(['v0.66.0', 'v0.66.1', 'v0.67.4'])
		const { status, outputs } = run(cwd, { INPUT_VERSION: 'refs/tags/v0.66.1' })
		expect(status).toBe(0)
		expect(outputs).toEqual({ npmTag: 'bump', versions: '0.66.1 0.66' })
	})

	test('the newest prerelease gets the next tag', () => {
		const cwd = withTags(['v0.67.4', 'v0.68.0-beta.1', 'v0.68.0-beta.2'])
		const { status, outputs } = run(cwd, { INPUT_VERSION: 'v0.68.0-beta.2' })
		expect(status).toBe(0)
		expect(outputs).toEqual({ npmTag: 'next', versions: '0.68.0-beta.2 0.68.0-beta 0.68-beta 0-beta' })
	})

	test('an input that is not a version sets no outputs', () => {
		const cwd = withTags(['v0.67.4'])
		const { status, outputs } = run(cwd, { INPUT_VERSION: 'main' })
		expect(status).toBe(0)
		expect(outputs).toEqual({})
	})

	test('a missing version input fails the step', () => {
		const cwd = withTags(['v0.67.4'])
		const { status, stderr, outputs } = run(cwd, {})
		expect(status).not.toBe(0)
		expect(stderr).toContain('Input required and not supplied: version')
		expect(outputs).toEqual({})
	})

	test('without an output file the step fails instead of losing the outputs', () => {
		const cwd = withTags(['v0.67.4'])
		const { status, stderr } = run(cwd, { INPUT_VERSION: 'v0.67.4' }, { withOutputFile: false })
		expect(status).not.toBe(0)
		expect(stderr).toContain('GITHUB_OUTPUT is not set')
	})
})
