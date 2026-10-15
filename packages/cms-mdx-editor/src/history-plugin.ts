/**
 * Undo and redo for the body editor and the slot editor.
 *
 * Milkdown ships this as `@milkdown/plugin-history`; ProseMirror's history is wired here
 * directly through `@milkdown/prose`, which Milkdown already depends on, so the editors
 * share one copy of ProseMirror with it.
 */
import { history, redo, undo } from '@milkdown/prose/history'
import { keymap } from '@milkdown/prose/keymap'
import { $prose } from '@milkdown/utils'

export const historyPlugin = $prose(() => history())

export const historyKeymap = $prose(() =>
	keymap({
		'Mod-z': undo,
		'Mod-Shift-z': redo,
		'Mod-y': redo,
	})
)

export { redo, undo }
