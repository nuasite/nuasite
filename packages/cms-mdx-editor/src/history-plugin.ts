/**
 * Undo and redo for the body editor and the slot editor.
 *
 * Milkdown ships this as `@milkdown/plugin-history`; ProseMirror's history is wired here
 * directly through `@milkdown/prose`, which Milkdown already depends on, so the editors
 * share one copy of ProseMirror with it.
 */
import { history, redo, undo } from '@milkdown/prose/history'
import { keymap } from '@milkdown/prose/keymap'
import type { Plugin } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { $prose } from '@milkdown/utils'

/** Cmd+Y opens the browser's history on a Mac, so redo keeps to Cmd+Shift+Z there. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform)

/** Every editor gets its own history plugin; this tells them apart from the other plugins. */
const historyPlugins = new WeakSet<Plugin>()

export const historyPlugin = $prose(() => {
	const plugin = history()
	historyPlugins.add(plugin)
	return plugin
})

export const historyKeymap = $prose(() =>
	keymap({
		'Mod-z': undo,
		'Mod-Shift-z': redo,
		...(isMac ? {} : { 'Mod-y': redo }),
	})
)

/**
 * Starts the undo history afresh. For a value the host replaced from outside: undo must not
 * take the editor back to text the host has thrown away, nor merge that replacement with the
 * typing just before it.
 *
 * Only the history is reset. A brand-new state (`replaceAll(value, true)`) would also restart
 * Milkdown's listener, and a change typed just before would then be reported after the new value.
 */
export function clearHistory(view: EditorView): void {
	const { plugins } = view.state
	const withoutHistory = plugins.filter(plugin => !historyPlugins.has(plugin))
	if (withoutHistory.length === plugins.length) return
	view.updateState(view.state.reconfigure({ plugins: withoutHistory }).reconfigure({ plugins }))
}

export { redo, undo }
