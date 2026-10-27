import type { Editor } from '@milkdown/core'
import { editorViewCtx } from '@milkdown/core'
import { toggleLinkCommand, updateLinkCommand } from '@milkdown/preset-commonmark'
import { callCommand } from '@milkdown/utils'
import type { RefObject } from 'preact'
import { useCallback, useMemo, useState } from 'preact/hooks'
import type { LinkSuggestion } from '../components/link-edit-popover.tsx'
import type { ActiveFormats } from '../milkdown-utils.ts'
import { removeLinkMark } from '../milkdown-utils.ts'
import { manifest } from '../signals.ts'

export interface LinkPopoverState {
	href: string
	isEdit: boolean
}

export function useLinkPopover(editorRef: RefObject<Editor | null>, activeFormats: ActiveFormats) {
	const [linkPopoverState, setLinkPopoverState] = useState<LinkPopoverState | null>(null)
	const linkPopoverOpen = linkPopoverState !== null
	const closeLinkPopover = useCallback(() => setLinkPopoverState(null), [])

	const pageSuggestions = useMemo<LinkSuggestion[]>(() =>
		(manifest.value.pages || []).map(p => ({
			value: p.pathname,
			label: p.title || p.pathname,
			description: p.title ? p.pathname : undefined,
		})), [manifest.value.pages])

	const toggleLinkPopover = useCallback(() => {
		if (!editorRef.current) return
		setLinkPopoverState((prev) => prev !== null ? null : { href: activeFormats.linkHref || 'https://', isEdit: activeFormats.link })
	}, [activeFormats.link, activeFormats.linkHref, editorRef])

	const applyLink = useCallback((url: string) => {
		if (!editorRef.current) return
		const isEdit = linkPopoverState?.isEdit ?? false
		closeLinkPopover()
		try {
			const view = editorRef.current.ctx.get(editorViewCtx)
			view.focus()
			if (isEdit) {
				editorRef.current.action(callCommand(updateLinkCommand.key, { href: url }))
			} else {
				editorRef.current.action(callCommand(toggleLinkCommand.key, { href: url }))
			}
		} catch (error) {
			console.error('Failed to apply link:', error)
		}
	}, [linkPopoverState, closeLinkPopover, editorRef])

	const removeLink = useCallback(() => {
		if (!editorRef.current) return
		closeLinkPopover()
		try {
			const view = editorRef.current.ctx.get(editorViewCtx)
			view.focus()
			removeLinkMark(view)
		} catch (error) {
			console.error('Failed to remove link:', error)
		}
	}, [closeLinkPopover, editorRef])

	return { linkPopoverState, linkPopoverOpen, closeLinkPopover, toggleLinkPopover, applyLink, removeLink, pageSuggestions }
}
