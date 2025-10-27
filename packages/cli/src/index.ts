#!/usr/bin/env node
import { agentsSummary } from '@nuasite/agent-summary'
import { dev, preview } from 'astro'
import { build } from './build'

const command = process.argv[2]

function printUsage() {
	console.log('Usage: nua <command>')
	console.log('\nCommands:')
	console.log('  build   Run astro build with the Nua defaults')
	console.log('  preview Run astro preview with the Nua defaults')
	console.log('  dev     Run astro dev with the Nua defaults')
	console.log('  help    Show this message\n')
}

const options = {
	root: process.cwd(),
	integrations: [agentsSummary()],
}

;(async () => {
	switch (command) {
		case 'build':
			await build(options)
			break
		case 'dev':
			await dev(options)
			break
		case 'preview':
			await preview(options)
			break
		case 'help':
		case '--help':
		case '-h':
			printUsage()
			break
		default:
			console.error(command ? `Unknown command: ${command}` : 'No command specified.')
			printUsage()
			process.exit(1)
	}
})().catch((error) => {
	console.error('Error:', error)
	process.exit(1)
})
