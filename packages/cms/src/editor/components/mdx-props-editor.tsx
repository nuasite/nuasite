import { useEffect, useState } from 'preact/hooks'
import { Z_INDEX, clampPanelPosition } from '../constants'
import { getComponentDefinition } from '../manifest'
import { closeMdxPropsEditor, manifest, mdxPropsEditorState } from '../signals'
import { MdxComponentIcon } from './mdx-block-view'
import { CancelButton, CloseButton } from './modal-shell'
import { PropEditor } from './prop-editor'

export function MdxPropsEditor({
	onUpdateProps,
}: {
	onUpdateProps: (nodePos: number, props: Record<string, string>) => void
}) {
	const state = mdxPropsEditorState.value
	const isVisible = state.isOpen && state.componentName !== null && state.nodePos !== null

	const definition = isVisible ? getComponentDefinition(manifest.value, state.componentName!) : undefined
	const [propValues, setPropValues] = useState<Record<string, string>>(state.props)

	useEffect(() => {
		if (isVisible) setPropValues(state.props)
	}, [state.nodePos, state.componentName, state.props, isVisible])

	if (!isVisible) return null

	const panelStyle = state.cursorPos ? clampPanelPosition(state.cursorPos, 360) : {}

	const handleSave = () => {
		if (state.nodePos !== null) {
			onUpdateProps(state.nodePos, propValues)
			closeMdxPropsEditor()
		}
	}

	return (
		<>
			<div
				data-cms-ui
				onClick={closeMdxPropsEditor}
				style={{ zIndex: Z_INDEX.SELECTION }}
				class="fixed inset-0"
			/>

			<div
				data-cms-ui
				onClick={(e: MouseEvent) => e.stopPropagation()}
				class="fixed w-90 bg-cms-dark shadow-[0_8px_32px_rgba(0,0,0,0.4)] font-sans text-sm overflow-hidden flex flex-col rounded-cms-xl border border-white/10"
				style={{ ...panelStyle, zIndex: Z_INDEX.MODAL }}
			>
				<div class="px-5 py-4 flex justify-between items-center border-b border-white/10">
					<div class="flex items-center gap-2">
						<MdxComponentIcon />
						<span class="font-semibold text-white">{state.componentName}</span>
					</div>
					<CloseButton onClick={closeMdxPropsEditor} />
				</div>

				<div class="p-5 overflow-y-auto flex-1">
					{definition
						? (
							definition.props.map((prop) => (
								<PropEditor
									key={prop.name}
									prop={prop}
									value={propValues[prop.name] || ''}
									onChange={(value) => setPropValues((prev) => ({ ...prev, [prop.name]: value }))}
								/>
							))
						)
						: (
							<div class="text-white/50 text-[13px]">
								<div class="mb-3">Unknown component — props not editable.</div>
								<div class="font-mono text-[11px] text-white/30 bg-white/5 p-3 rounded-cms-md break-all">
									{Object.entries(propValues).map(([k, v]) => <div key={k}>{k}="{v}"</div>)}
								</div>
							</div>
						)}
				</div>

				{definition && (
					<div class="px-5 py-4 border-t border-white/10 flex gap-2 justify-end">
						<CancelButton onClick={closeMdxPropsEditor} />
						<button
							onClick={handleSave}
							class="px-4 py-2.5 bg-cms-primary text-cms-primary-text rounded-cms-pill cursor-pointer hover:bg-cms-primary-hover transition-all font-medium"
						>
							Save
						</button>
					</div>
				)}
			</div>
		</>
	)
}
