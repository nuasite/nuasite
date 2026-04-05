import { useState } from 'preact/hooks'
import { getComponentDefinitions } from '../manifest'
import { manifest, mdxComponentPickerOpen } from '../signals'
import { ComponentCard, getDefaultProps } from './component-card'
import { CancelButton, ModalBackdrop, ModalHeader } from './modal-shell'
import { PropEditor } from './prop-editor'

export interface MdxComponentPickerProps {
	onInsert: (componentName: string, props: Record<string, string>) => void
}

export function MdxComponentPicker({ onInsert }: MdxComponentPickerProps) {
	const isOpen = mdxComponentPickerOpen.value
	const [selectedComponent, setSelectedComponent] = useState<string | null>(null)
	const [propValues, setPropValues] = useState<Record<string, string>>({})
	const [searchQuery, setSearchQuery] = useState('')

	if (!isOpen) return null

	const componentDefinitions = getComponentDefinitions(manifest.value)

	const resetSelection = () => {
		setSelectedComponent(null)
		setPropValues({})
	}

	const close = () => {
		mdxComponentPickerOpen.value = false
		resetSelection()
		setSearchQuery('')
	}

	const handleSelectComponent = (name: string) => {
		const def = componentDefinitions[name]
		if (!def) return
		setSelectedComponent(name)
		setPropValues(getDefaultProps(def))
	}

	const handleConfirmInsert = () => {
		if (selectedComponent) {
			onInsert(selectedComponent, propValues)
			close()
		}
	}

	const mdxAllowList = manifest.value?.mdxComponents
	const filteredDefs = Object.values(componentDefinitions).filter((def) => {
		if (mdxAllowList && !mdxAllowList.includes(def.name)) return false
		return !searchQuery || def.name.toLowerCase().includes(searchQuery.toLowerCase())
			|| def.description?.toLowerCase().includes(searchQuery.toLowerCase())
	})

	return (
		<ModalBackdrop onClose={close} maxWidth="max-w-md" extraClass="max-h-[80vh] flex flex-col overflow-hidden">
			{selectedComponent
				? (
					<>
						<ModalHeader title={`Configure ${selectedComponent}`} onBack={resetSelection} onClose={close} />
						<div class="p-5 overflow-y-auto flex-1">
							<div class="px-4 py-3 bg-white/10 rounded-cms-md mb-4 text-[13px] text-white">
								Inserting <strong>{selectedComponent}</strong> at cursor position
							</div>
							{(() => {
								const selectedDef = componentDefinitions[selectedComponent]
								if (!selectedDef || selectedDef.props.length === 0) {
									return (
										<div class="text-white/50 text-[13px]">
											This component has no configurable props.
										</div>
									)
								}
								return selectedDef.props.map((prop) => (
									<PropEditor
										key={prop.name}
										prop={prop}
										value={propValues[prop.name] || ''}
										onChange={(value) => setPropValues((prev) => ({ ...prev, [prop.name]: value }))}
									/>
								))
							})()}
						</div>
						<div class="px-5 py-4 border-t border-white/10 flex gap-2 justify-end">
							<CancelButton onClick={resetSelection} label="Back" />
							<button
								onClick={handleConfirmInsert}
								class="px-4 py-2.5 bg-cms-primary text-cms-primary-text rounded-cms-pill cursor-pointer hover:bg-cms-primary-hover transition-all font-medium"
							>
								Insert
							</button>
						</div>
					</>
				)
				: (
					<>
						<ModalHeader title="Insert Component" onClose={close} />
						<div class="px-5 pt-4">
							<input
								type="text"
								value={searchQuery}
								onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
								placeholder="Search components..."
								class="w-full px-4 py-2.5 bg-white/10 border border-white/20 text-[13px] text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-md"
							/>
						</div>
						<div class="p-5 overflow-y-auto flex-1">
							{filteredDefs.length === 0
								? (
									<div class="text-center text-white/50 py-8">
										{searchQuery ? 'No components match your search.' : 'No components available.'}
									</div>
								)
								: (
									<div class="flex flex-col gap-2">
										{filteredDefs.map((def) => <ComponentCard key={def.name} def={def} onClick={() => handleSelectComponent(def.name)} />)}
									</div>
								)}
						</div>
					</>
				)}
		</ModalBackdrop>
	)
}
