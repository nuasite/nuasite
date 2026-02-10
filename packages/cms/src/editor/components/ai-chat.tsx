import { marked } from 'marked'
import { useEffect, useRef, useState } from 'preact/hooks'
import { CSS } from '../constants'
import { getComponentInstance } from '../manifest'
import * as signals from '../signals'

// Configure marked for safe HTML output
marked.setOptions({
	breaks: true, // Convert \n to <br>
	gfm: true, // GitHub Flavored Markdown
})

/**
 * Sanitize HTML output to prevent XSS from AI-generated content.
 * Strips dangerous tags and event handler attributes.
 */
function sanitizeHtml(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html')
	for (const el of doc.querySelectorAll('script,style,iframe,object,embed,form')) {
		el.remove()
	}
	for (const el of doc.querySelectorAll('*')) {
		for (const attr of Array.from(el.attributes)) {
			if (attr.name.startsWith('on') || attr.name === 'srcdoc') {
				el.removeAttribute(attr.name)
			}
			if (
				['href', 'src', 'action'].includes(attr.name)
				&& attr.value.trim().toLowerCase().startsWith('javascript:')
			) {
				el.removeAttribute(attr.name)
			}
		}
	}
	return doc.body.innerHTML
}

/**
 * Escape HTML entities for safe rendering as text
 */
function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Render markdown to sanitized HTML
 */
function renderMarkdown(content: string): string {
	try {
		const html = marked.parse(content, { async: false }) as string
		return sanitizeHtml(html)
	} catch {
		return escapeHtml(content)
	}
}

export interface AIChatCallbacks {
	onSend: (message: string, elementId?: string) => void
	onClose: () => void
	onCancel: () => void
	onApplyToElement: (content: string, elementId: string) => void
}

export interface AIChatProps {
	callbacks: AIChatCallbacks
}

/**
 * Get a friendly label for the context element
 */
function getContextLabel(elementId: string): string {
	const manifest = signals.manifest.value
	const instance = getComponentInstance(manifest, elementId)
	if (instance) {
		return instance.componentName
	}
	return elementId
}

export const AIChat = ({ callbacks }: AIChatProps) => {
	const [message, setMessage] = useState('')
	const [appliedMessages, setAppliedMessages] = useState<Set<string>>(
		new Set(),
	)
	const [position, setPosition] = useState<'left' | 'right'>('right')
	const [isMinimized, setIsMinimized] = useState(false)
	const [isDragging, setIsDragging] = useState(false)
	const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null)
	const dragOffsetRef = useRef({ x: 0, y: 0 })
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const containerRef = useRef<HTMLDivElement>(null)

	const open = signals.isChatOpen.value
	const messages = signals.chatMessages.value
	const contextElementId = signals.chatContextElementId.value
	const inputDisabled = signals.isAIProcessing.value
	const currentStatus = signals.currentStatus.value
	const statusMessage = signals.statusMessage.value

	// Reset applied messages when chat opens (history may have changed)
	useEffect(() => {
		if (open) {
			setAppliedMessages(new Set())
		}
	}, [open])

	// Handle drag start
	const handleDragStart = (e: MouseEvent) => {
		if (!containerRef.current) return
		const rect = containerRef.current.getBoundingClientRect()
		dragOffsetRef.current = {
			x: e.clientX - rect.left,
			y: e.clientY - rect.top,
		}
		setDragPosition({ x: rect.left, y: rect.top })
		setIsDragging(true)
	}

	// Handle drag move and end
	useEffect(() => {
		if (!isDragging) return

		const handleMouseMove = (e: MouseEvent) => {
			setDragPosition({
				x: e.clientX - dragOffsetRef.current.x,
				y: e.clientY - dragOffsetRef.current.y,
			})
		}

		const handleMouseUp = (e: MouseEvent) => {
			setIsDragging(false)
			// Snap to left or right based on position
			const windowCenter = window.innerWidth / 2
			const currentX = e.clientX - dragOffsetRef.current.x
			const containerWidth = containerRef.current?.offsetWidth || 400
			const containerCenter = currentX + containerWidth / 2

			if (containerCenter < windowCenter) {
				setPosition('left')
			} else {
				setPosition('right')
			}
			setDragPosition(null)
		}

		document.addEventListener('mousemove', handleMouseMove)
		document.addEventListener('mouseup', handleMouseUp)

		return () => {
			document.removeEventListener('mousemove', handleMouseMove)
			document.removeEventListener('mouseup', handleMouseUp)
		}
	}, [isDragging])

	// biome-ignore lint/correctness/useExhaustiveDependencies: need to scroll to the bottom when messages change
	useEffect(() => {
		if (messagesEndRef.current) {
			messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
		}
	}, [messages, currentStatus])

	useEffect(() => {
		if (open && textareaRef.current && !inputDisabled) {
			setTimeout(() => textareaRef.current?.focus(), 50)
		}
	}, [open, inputDisabled])

	// Highlight the selected context element on the page
	useEffect(() => {
		if (!open || !contextElementId) return

		const el = document.querySelector(`[${CSS.COMPONENT_ID_ATTRIBUTE}="${contextElementId}"]`)
		if (!el) return

		const htmlEl = el as HTMLElement
		const prev = htmlEl.style.outline
		const prevOffset = htmlEl.style.outlineOffset
		htmlEl.style.outline = '2px solid rgba(99, 102, 241, 0.7)'
		htmlEl.style.outlineOffset = '2px'

		return () => {
			htmlEl.style.outline = prev
			htmlEl.style.outlineOffset = prevOffset
		}
	}, [open, contextElementId])

	const contextLabel = contextElementId ? getContextLabel(contextElementId) : null

	const handleSubmit = (e: Event) => {
		e.preventDefault()
		if (message.trim() && !inputDisabled) {
			callbacks.onSend(message.trim(), contextElementId || undefined)
			setMessage('')
			if (textareaRef.current) {
				textareaRef.current.style.height = 'auto'
			}
		}
	}

	const handleTextareaInput = (e: Event) => {
		const target = e.target as HTMLTextAreaElement
		setMessage(target.value)
		target.style.height = 'auto'
		target.style.height = `${Math.min(target.scrollHeight, 120)}px`
	}

	const handleTextareaKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			handleSubmit(e)
		}
	}

	const handleApply = (
		messageId: string,
		content: string,
		elementId: string,
	) => {
		callbacks.onApplyToElement(content, elementId)
		setAppliedMessages(new Set(appliedMessages).add(messageId))
	}

	if (!open) {
		return null
	}

	const stopPropagation = (e: Event) => e.stopPropagation()

	const containerStyle = dragPosition
		? {
			left: `${dragPosition.x}px`,
			top: `${dragPosition.y}px`,
			right: 'auto',
			bottom: 'auto',
			height: isMinimized ? 'auto' : 'calc(100vh - 40px)',
		}
		: undefined

	const positionClass = position === 'left' ? 'left-5' : 'right-5'

	return (
		<div
			ref={containerRef}
			class={`fixed ${dragPosition ? '' : positionClass} top-5 ${
				isMinimized ? '' : 'bottom-5'
			} w-100 max-w-[calc(100vw-40px)] bg-cms-dark shadow-[0_8px_32px_rgba(0,0,0,0.4)] rounded-cms-xl border border-white/10 z-2147483645 flex flex-col font-sans overflow-hidden ${
				isDragging ? '' : 'transition-all duration-300'
			}`}
			style={containerStyle}
			data-cms-ui
			onMouseDown={stopPropagation}
			onClick={stopPropagation}
		>
			<div
				class={`px-5 py-4 flex items-center justify-between border-b border-white/10 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
				onMouseDown={handleDragStart}
			>
				<div class="flex items-center gap-2.5">
					<div class="flex items-center text-white">
						<svg
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
						</svg>
					</div>
					<h3 class="m-0 text-base font-semibold text-white">
						AI Assistant
					</h3>
				</div>
				<div class="flex items-center gap-1">
					<button
						onClick={(e) => {
							e.stopPropagation()
							setIsMinimized(!isMinimized)
						}}
						onMouseDown={(e) => e.stopPropagation()}
						class="bg-white/10 border-none text-white/80 text-sm cursor-pointer p-1.5 leading-none transition-all w-8 h-8 flex items-center justify-center hover:bg-white/20 hover:text-white rounded-full"
						title={isMinimized ? 'Expand' : 'Minimize'}
					>
						{isMinimized
							? (
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
									<polyline points="15 3 21 3 21 9" />
									<polyline points="9 21 3 21 3 15" />
									<line x1="21" y1="3" x2="14" y2="10" />
									<line x1="3" y1="21" x2="10" y2="14" />
								</svg>
							)
							: (
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
									<polyline points="4 14 10 14 10 20" />
									<polyline points="20 10 14 10 14 4" />
									<line x1="14" y1="10" x2="21" y2="3" />
									<line x1="3" y1="21" x2="10" y2="14" />
								</svg>
							)}
					</button>
					<button
						onClick={(e) => {
							e.stopPropagation()
							callbacks.onClose()
						}}
						onMouseDown={(e) => e.stopPropagation()}
						class="bg-white/10 border-none text-white/80 text-xl cursor-pointer p-1.5 leading-none transition-all w-8 h-8 flex items-center justify-center hover:bg-white/20 hover:text-white rounded-full"
					>
						&times;
					</button>
				</div>
			</div>

			{!isMinimized && (
				<>
					<div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-black/20">
						{messages.length === 0
							? (
								<div class="flex flex-col items-center justify-center h-full text-white text-center p-10">
									<svg
										width="48"
										height="48"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
										class="mb-4 text-white/30"
									>
										<path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
									</svg>
									<div class="text-sm font-semibold mb-2 text-white">
										Start a conversation
									</div>
									<div class="text-xs text-white/50">
										Ask AI to help you edit content
									</div>
								</div>
							)
							: (
								messages.map((msg) => (
									<div
										key={msg.id}
										class="flex flex-col gap-1.5 animate-[slideIn_0.2s_ease]"
									>
										{msg.role === 'assistant' && !msg.content.trim()
											? (
												<div class="px-4 py-3 text-[13px] leading-relaxed max-w-[85%] bg-white/10 text-white/50 self-start rounded-cms-lg rounded-bl-cms-sm border border-white/10 flex items-center gap-1.5">
													<span class="inline-block w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce [animation-delay:0ms]" />
													<span class="inline-block w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce [animation-delay:150ms]" />
													<span class="inline-block w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce [animation-delay:300ms]" />
												</div>
											)
											: (
												<div
													class={`px-4 py-3 text-[13px] leading-relaxed wrap-break-word max-w-[85%] ${
														msg.role === 'user'
															? 'bg-cms-primary text-cms-primary-text self-end rounded-cms-lg rounded-br-cms-sm'
															: 'bg-white/10 text-white self-start rounded-cms-lg rounded-bl-cms-sm cms-markdown border border-white/10'
													}`}
													// biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown rendering requires innerHTML
													dangerouslySetInnerHTML={msg.role === 'assistant'
														? { __html: renderMarkdown(msg.content) }
														: undefined}
												>
													{msg.role === 'user' ? msg.content : undefined}
												</div>
											)}
										{msg.elementId && (
											<div
												class={`text-[10px] text-white/40 font-mono px-1 ${msg.role === 'user' ? 'self-end' : 'self-start'}`}
											>
												{msg.elementId}
											</div>
										)}
										{
											/* TODO: Re-enable when we can apply partial content instead of whole message
										{msg.role === 'assistant' && msg.elementId && (
											<button
												onClick={() => handleApply(msg.id, msg.content, msg.elementId!)}
												disabled={appliedMessages.has(msg.id)}
												class={`px-3 py-1.5 text-[11px] font-medium cursor-pointer self-start transition-all mt-1 rounded-cms-pill ${
													appliedMessages.has(msg.id)
														? 'bg-white/10 text-white/50 cursor-not-allowed'
														: 'bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover'
												}`}
											>
												{appliedMessages.has(msg.id)
													? '✓ Applied'
													: 'Apply to element'}
											</button>
										)}
										*/
										}
									</div>
								))
							)}

						{/* Status indicator */}
						{currentStatus && (
							<div class="flex items-center gap-2 px-3 py-1.5 text-[11px] text-white/40 self-start animate-[slideIn_0.2s_ease]">
								<StatusIcon status={currentStatus} />
								<span>
									{statusMessage || getDefaultStatusMessage(currentStatus)}
								</span>
							</div>
						)}

						<div ref={messagesEndRef} />
					</div>

					<div class="p-4 border-t border-white/10 bg-cms-dark rounded-b-cms-xl">
						{contextElementId && contextLabel
							? (
								<div class="px-3 py-2 bg-white/10 rounded-cms-md mb-3 text-[11px] text-white/60 relative">
									<button
										onClick={() => signals.setChatContextElement(null)}
										class="absolute top-2 right-2 bg-none border-none text-white/50 cursor-pointer p-0 text-sm leading-none hover:text-white"
									>
										&times;
									</button>
									<div class="font-medium mb-0.5">Editing:</div>
									<div class="text-white font-medium">{contextLabel}</div>
								</div>
							)
							: (
								<div class="px-3 py-2 rounded-cms-md mb-3 text-[11px] text-white/30">
									Click on section on the page to focus the conversation
								</div>
							)}
						<form onSubmit={handleSubmit} class="flex gap-2">
							<textarea
								ref={textareaRef}
								placeholder="Ask AI anything..."
								rows={1}
								value={message}
								onInput={handleTextareaInput}
								onKeyDown={handleTextareaKeyDown}
								disabled={inputDisabled}
								class={`flex-1 px-4 py-3 border border-white/20 text-[13px] font-sans resize-none max-h-30 transition-all outline-none focus:border-white/40 focus:ring-1 focus:ring-white/10 rounded-cms-lg placeholder:text-white/40 ${
									inputDisabled
										? 'bg-white/5 text-white/50 opacity-60'
										: 'bg-white/10 text-white'
								}`}
							/>
							{inputDisabled
								? (
									<button
										type="button"
										onClick={() => callbacks.onCancel()}
										class="px-4 cursor-pointer transition-all flex items-center justify-center rounded-cms-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 hover:text-red-200 border border-red-500/30"
										title="Cancel request"
									>
										<svg
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
										</svg>
									</button>
								)
								: (
									<button
										type="submit"
										class="px-4 cursor-pointer transition-all flex items-center justify-center rounded-cms-lg bg-cms-primary text-cms-primary-text hover:bg-cms-primary-hover"
									>
										<svg
											width="16"
											height="16"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<line x1="22" y1="2" x2="11" y2="13"></line>
											<polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
										</svg>
									</button>
								)}
						</form>
					</div>
				</>
			)}
		</div>
	)
}

/**
 * Get default status message for a status type
 */
function getDefaultStatusMessage(status: string): string {
	switch (status) {
		case 'thinking':
			return 'Thinking...'
		case 'coding':
			return 'Writing code...'
		case 'building':
			return 'Building preview...'
		case 'deploying':
			return 'Deploying...'
		case 'complete':
			return 'Done!'
		default:
			return 'Processing...'
	}
}

/**
 * Status indicator icon component
 */
function StatusIcon({ status }: { status: string }) {
	switch (status) {
		case 'thinking':
			return (
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					class="animate-pulse text-purple-600"
				>
					<circle cx="12" cy="12" r="10" />
					<path d="M12 16v-4m0-4h.01" />
				</svg>
			)
		case 'coding':
			return (
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					class="text-blue-600"
				>
					<polyline points="16 18 22 12 16 6" />
					<polyline points="8 6 2 12 8 18" />
				</svg>
			)
		case 'building':
			return (
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					class="animate-spin text-orange-600"
				>
					<path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
				</svg>
			)
		case 'deploying':
			return (
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					class="animate-bounce text-green-600"
				>
					<path d="M12 19V5m-7 7l7-7 7 7" />
				</svg>
			)
		case 'complete':
			return (
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					class="text-green-600"
				>
					<path d="M20 6L9 17l-5-5" />
				</svg>
			)
		default:
			return (
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					class="animate-spin text-slate-600"
				>
					<path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
				</svg>
			)
	}
}
