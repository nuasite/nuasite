import type { Node } from '@milkdown/prose/model'
import { Plugin } from '@milkdown/prose/state'

/** Keep the host draft current before a toolbar action can be followed by Save. */
export function documentChangePlugin(onChange: (doc: Node) => void) {
	return new Plugin({ view: () => ({ update(view, previous) {
		if (!view.state.doc.eq(previous.doc)) onChange(view.state.doc)
	} }) })
}
