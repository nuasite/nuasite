import { describe, expect, test } from 'bun:test'
import { nodeCompileAstro } from '../../src/project/default-node.ts'
import type { ProjectFiles } from '../../src/project/files.ts'
import { guardSourceWrites, UnparsableSourceError } from '../../src/project/source-guard.ts'

// An attribute expression left open swallows the `<style>` below it: Astro's `parse` accepts the file,
// and the build stops on the code the compiler emitted.
const OPEN_ATTRIBUTE_EXPRESSION = '---\nconst open = false\n---\n<header class={open>Menu</header>\n<style>\n  header { color: red; }\n</style>\n'
const VALID = '---\nconst open = false\n---\n<header class={open ? "open" : ""}>Menu</header>\n<style>\n  header { color: red; }\n</style>\n'

function memoryFiles(initial: Record<string, string>): { files: ProjectFiles; written: Map<string, string | Uint8Array> } {
	const written = new Map<string, string | Uint8Array>(Object.entries(initial))
	const files: ProjectFiles = {
		readFile: async filePath => {
			const content = written.get(filePath)
			if (typeof content !== 'string') throw new Error(`ENOENT: ${filePath}`)
			return content
		},
		readBytes: async () => new Uint8Array(),
		writeFile: async (filePath, content) => void written.set(filePath, content),
		readdir: async () => [],
		access: async () => {},
		stat: async () => ({ isDirectory: () => false, isFile: () => true, mtimeMs: 0 }),
	}
	return { files, written }
}

const guarded = (files: ProjectFiles) => guardSourceWrites(files, () => '/project', nodeCompileAstro)

describe('guardSourceWrites', () => {
	test('a component that would not parse is not written, and the refusal names its line', async () => {
		const { files, written } = memoryFiles({ '/project/src/components/Header.astro': VALID })

		const refusal = await guarded(files).writeFile('/project/src/components/Header.astro', OPEN_ATTRIBUTE_EXPRESSION).then(
			() => null,
			(error: unknown) => error,
		)

		expect(refusal).toBeInstanceOf(UnparsableSourceError)
		expect(String(refusal)).toContain('src/components/Header.astro:4:')
		expect(written.get('/project/src/components/Header.astro')).toBe(VALID)
	})

	test('a new file is checked too', async () => {
		const { files, written } = memoryFiles({})

		const refusal = await guarded(files).writeFile('/project/src/lib/menu.ts', 'export const list = [1, 2\n').then(
			() => null,
			(error: unknown) => error,
		)

		expect(refusal).toBeInstanceOf(UnparsableSourceError)
		expect(written.has('/project/src/lib/menu.ts')).toBe(false)
	})

	test('a component that parses, content and assets are written', async () => {
		const { files, written } = memoryFiles({})
		const guard = guarded(files)

		await guard.writeFile('/project/src/components/Header.astro', VALID)
		await guard.writeFile('/project/src/content/blog/a.md', '---\ntitle: {\n---\n')
		await guard.writeFile('/project/public/logo.png', new Uint8Array([1]))

		expect([...written.keys()]).toEqual(['/project/src/components/Header.astro', '/project/src/content/blog/a.md', '/project/public/logo.png'])
	})

	test('a file that did not parse before the write is still written: the edit did not break it', async () => {
		const { files, written } = memoryFiles({ '/project/src/components/Header.astro': OPEN_ATTRIBUTE_EXPRESSION })
		const edited = OPEN_ATTRIBUTE_EXPRESSION.replace('Menu', 'Navigation')

		await guarded(files).writeFile('/project/src/components/Header.astro', edited)

		expect(written.get('/project/src/components/Header.astro')).toBe(edited)
	})
})
