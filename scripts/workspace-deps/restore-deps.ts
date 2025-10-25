import fs from 'node:fs'
import path from 'node:path'

const LEDGER = path.join(process.cwd(), '.rewritten-workspace-deps.json')
if (!fs.existsSync(LEDGER)) process.exit(0)

const entries = JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
const last = entries.pop() // restore the one we just packed
if (last) fs.writeFileSync(last.p, last.content)

// keep ledger for parallel packs; remove if empty
if (entries.length === 0) fs.rmSync(LEDGER)
else fs.writeFileSync(LEDGER, JSON.stringify(entries, null, 2))
