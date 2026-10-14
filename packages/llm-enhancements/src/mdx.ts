/**
 * Make an `.mdx` entry body readable as plain markdown, or say it cannot be.
 *
 * ESM blocks are dropped: in MDX an `import`/`export` at the start of a line opens a block that runs
 * to the next blank line, and none of it is content. A body that still uses a component after that
 * (`<Medailonek jmeno="…" />`) returns `undefined`: the component renders text the source only names,
 * so the page's rendered HTML says more than the entry does. Fenced code is left alone throughout, so
 * an example in a code block neither counts as a component nor loses its `import` lines.
 */
export function mdxBodyAsMarkdown(body: string): string | undefined {
	const kept: string[] = []
	let inFence = false
	let inEsm = false

	for (const line of body.split('\n')) {
		if (!inEsm && /^\s{0,3}(```|~~~)/.test(line)) {
			inFence = !inFence
			kept.push(line)
			continue
		}
		if (inFence) {
			kept.push(line)
			continue
		}
		if (inEsm) {
			if (line.trim() === '') inEsm = false
			continue
		}
		if (/^(import|export)\s/.test(line)) {
			inEsm = true
			continue
		}
		if (usesComponent(line)) return undefined
		kept.push(line)
	}

	return kept.join('\n').replace(/^\n+/, '')
}

/**
 * A capitalised tag outside inline code and outside a link destination written in angle brackets
 * (`[text](<Some page>)`, plain CommonMark that only looks like one).
 */
function usesComponent(line: string): boolean {
	const prose = line.replace(/`[^`]*`/g, '').replace(/\]\(<[^>\n]*>/g, '](')
	return /<[A-Z][\w.]*(\s|\/?>|$)/.test(prose)
}
