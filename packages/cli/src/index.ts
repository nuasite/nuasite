#!/usr/bin/env node
import { agentsSummary } from '@nuasite/agent-summary'
import { build } from './build.js'

const command = process.argv[2]

function printUsage() {
	console.log('Usage: nua <command>')
	console.log('\nCommands:')
	console.log('  build   Run astro build with the Nua defaults')
	console.log('  help    Show this message\n')
}

switch (command) {
	case 'build':
		await build({
			integrations: [agentsSummary()],
		})
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
