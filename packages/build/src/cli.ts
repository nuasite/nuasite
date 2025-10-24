#!/usr/bin/env node
import { agentsSummary } from '@nuasite/agent-summary'
import { build } from './build.js'

await build({
	integrations: [agentsSummary()],
})
