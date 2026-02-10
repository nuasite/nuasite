import { useEffect } from 'preact/hooks'
import * as signals from './signals'
import type { CmsConfig, EditorState } from './types'

export interface CmsProviderProps {
	children: any
	initialConfig?: CmsConfig
	initialState?: EditorState
}

/**
 * CMS Provider component.
 *
 * With signals, this provider is mainly for initialization and legacy compatibility.
 * New code should import signals directly rather than using context.
 */
export function CmsProvider({ children, initialConfig, initialState }: CmsProviderProps) {
	// Initialize signals from props if provided
	// biome-ignore lint/correctness/useExhaustiveDependencies: only run on mount
	useEffect(() => {
		if (initialConfig) {
			signals.setConfig(initialConfig)
		}

		if (initialState) {
			signals.batch(() => {
				signals.setEnabled(initialState.isEnabled)
				signals.setEditing(initialState.isEditing)
				signals.setShowingOriginal(initialState.showingOriginal)
				signals.setCurrentEditingId(initialState.currentEditingId)
				signals.setCurrentComponentId(initialState.currentComponentId)
				signals.setManifest(initialState.manifest)
			})
		}
	}, [])

	return <>{children}</>
}
