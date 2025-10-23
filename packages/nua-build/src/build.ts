import { build as astroBuild } from 'astro'
import Stacktracey from 'stacktracey'

export async function build() {
	try {
		await astroBuild({})
	} catch (error) {
		if (error instanceof Error) {
			const stack = new Stacktracey(error.stack).withSources()
			console.error('\nBuild failed:', error.message)
			for (const frame of stack.items) {
				if (frame.native || frame.fileShort.includes('node_modules') || frame.line === undefined) {
					console.error(`at ${frame.calleeShort} (${frame.fileShort}:${frame.line}:${frame.column})`)
					continue
				}

				const contextLines = frame.sourceFile?.lines.slice(frame.line - 3, frame.line + 2) || []
				const context = contextLines.map((line, index) => {
					const lineNumber = frame.line! - 2 + index
					const isCurrentPrefix = lineNumber === frame.line ? '>' : ' '
					return `${isCurrentPrefix} ${lineNumber}: ${line}`
				}).join('\n')
				console.error(`at ${frame.calleeShort} (${frame.fileShort}:${frame.line}:${frame.column})\n${context}`)
			}
		} else {
			console.error('Build failed:', error)
		}
		process.exit(1)
	}
}
