import { useEffect, useRef, useState } from 'preact/hooks'

export interface AITooltipCallbacks {
	onPromptSubmit: (prompt: string, elementId: string) => void
}

export interface AITooltipProps {
	callbacks: AITooltipCallbacks
	visible: boolean
	elementId: string | null
	rect: DOMRect | null
	processing: boolean
}

export function AITooltip({ callbacks, visible, elementId, rect, processing }: AITooltipProps) {
	const [isExpanded, setIsExpanded] = useState(false)
	const [prompt, setPrompt] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (!visible) {
			setIsExpanded(false)
			setPrompt('')
		}
	}, [visible])

	useEffect(() => {
		if (isExpanded && inputRef.current) {
			setTimeout(() => inputRef.current?.focus(), 50)
		}
	}, [isExpanded])

	if (!visible || !rect || !elementId) {
		return null
	}

	// Don't show empty tooltip when not expanded and not processing
	// (the content for this state is not yet implemented)
	if (!isExpanded && !processing) {
		return null
	}

	// Calculate position
	const tooltipWidth = 200
	const tooltipHeight = 50
	let left = rect.left + rect.width / 2 - tooltipWidth / 2
	let top = rect.top - tooltipHeight - 8

	const padding = 10
	const maxLeft = window.innerWidth - tooltipWidth - padding
	const minLeft = padding

	left = Math.max(minLeft, Math.min(left, maxLeft))

	if (top < padding) {
		top = rect.bottom + 8
	}

	const maxTop = window.innerHeight - tooltipHeight - padding
	top = Math.min(top, maxTop)

	const handleExpand = (e: MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (!isExpanded && elementId) {
			setIsExpanded(true)
		}
	}

	const handleCancel = (e: MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		setIsExpanded(false)
	}

	const handleSubmit = (e: Event) => {
		e.preventDefault()
		e.stopPropagation()
		if (prompt.trim() && elementId) {
			callbacks.onPromptSubmit(prompt.trim(), elementId)
			setIsExpanded(false)
			setPrompt('')
		}
	}

	const handleMouseDown = (e: MouseEvent) => {
		// Stop propagation to prevent the click-outside handler from hiding the tooltip
		e.stopPropagation()
	}

	return (
		<div
			data-cms-ui
			onMouseDown={handleMouseDown}
			onClick={(e: MouseEvent) => e.stopPropagation()}
			style={{
				position: 'fixed',
				left: `${left}px`,
				top: `${top}px`,
				zIndex: 2147483645,
				fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
				fontSize: '12px',
			}}
		>
			<div
				class={`tooltip ${isExpanded ? 'expanded' : ''} ${
					processing ? 'processing' : ''
				} bg-cms-dark shadow-[0_8px_32px_rgba(0,0,0,0.3)] border border-white/10 text-white cursor-pointer transition-all duration-200 pointer-events-auto select-none rounded-cms-lg`}
				onClick={handleExpand}
				onMouseDown={handleMouseDown}
				style={{
					padding: isExpanded ? '16px' : '10px 14px',
					minWidth: isExpanded ? '280px' : 'auto',
					maxWidth: isExpanded ? '320px' : 'auto',
				}}
			>
				{
					// TODO: Implement AI tooltip
					/*{!isExpanded && !processing && (
					<div class="flex items-center gap-1.5 text-cms-secondary">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
						</svg>
						<span class="font-medium">Ask AI to edit</span>
					</div>
				)}*/
				}
				{processing && (
					<div class="flex items-center gap-2 text-white/70">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="animate-spin">
							<path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
						</svg>
						<span class="font-medium">Processing...</span>
					</div>
				)}
				{isExpanded && !processing && (
					<form class="prompt-form flex flex-col gap-3" onSubmit={handleSubmit}>
						<label class="text-[11px] text-white/50 font-medium">What would you like to change?</label>
						<input
							ref={inputRef}
							type="text"
							placeholder="e.g., make it shorter..."
							value={prompt}
							onInput={(e) => setPrompt((e.target as HTMLInputElement).value)}
							onMouseDown={(e) => e.stopPropagation()}
							class="w-full px-3 py-2 border border-white/20 bg-white/10 text-white text-xs font-sans outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 transition-all rounded-cms-sm placeholder:text-white/40"
						/>
						<div class="flex gap-2 justify-end">
							<button
								type="button"
								onClick={handleCancel}
								onMouseDown={(e) => e.stopPropagation()}
								class="px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-all bg-white/10 text-white/80 hover:bg-white/20 hover:text-white rounded-cms-pill"
							>
								Cancel
							</button>
							<button
								type="submit"
								onMouseDown={(e) => e.stopPropagation()}
								class="px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-all bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover rounded-cms-pill"
							>
								Apply
							</button>
						</div>
					</form>
				)}
			</div>
		</div>
	)
}
