import { useCallback, useMemo, useRef } from 'preact/hooks'
import { AIService, type CmsAiAction } from '../ai'
import { getChatHistory } from '../api'
import { getEditableTextFromElement, logDebug } from '../dom'
import { handleElementChange } from '../editor'
import { getComponentDefinition, getComponentInstance, getManifestEntry } from '../manifest'
import * as signals from '../signals'
import type { AIStatusType, ChatMessage, CmsConfig } from '../types'

export interface AIHandlersOptions {
	config: CmsConfig
	showToast: (message: string, type?: 'info' | 'success' | 'error') => void
	onTooltipHide: () => void
	onUIUpdate?: () => void
}

// Counter for generating unique message IDs
let messageIdCounter = 0
function nextMessageId(prefix: string): string {
	return `${prefix}-${Date.now()}-${++messageIdCounter}`
}

/**
 * Hook providing AI-related handlers for the CMS editor.
 * Uses signals directly for state management.
 */
export function useAIHandlers({
	config,
	showToast,
	onTooltipHide,
	onUIUpdate,
}: AIHandlersOptions) {
	// Create AI service instance - memoized to avoid recreation on each render
	const aiService = useMemo(() => new AIService(config), [config])

	// Guard against stale chat history responses
	const historyRequestRef = useRef(0)

	/**
	 * Toggle AI chat visibility
	 */
	const handleAIChatToggle = useCallback(async () => {
		if (signals.isChatOpen.value) {
			signals.setAIChatOpen(false)
		} else {
			signals.setAIChatOpen(true)
			const currentId = signals.currentEditingId.value
			if (currentId) {
				signals.setChatContextElement(currentId)
			}

			// Load chat history when opening
			const requestId = ++historyRequestRef.current
			try {
				const history = await getChatHistory(config.apiBase)
				// Discard if a newer request has been made
				if (requestId !== historyRequestRef.current) return
				if (history.messages && history.messages.length > 0) {
					// Convert API messages to ChatMessage format
					const chatMessages: ChatMessage[] = history.messages
						.filter((msg) => {
							// Skip tool-role messages that may have slipped through
							if (msg.role === 'tool') return false
							const content = msg.content?.trim() || ''
							// Skip empty messages
							if (!content) return false
							return true
						})
						.map((msg) => ({
							id: msg.id,
							role: msg.role as 'user' | 'assistant',
							content: msg.content || '',
							timestamp: new Date(msg.created_at).getTime(),
						}))
					signals.setChatMessages(chatMessages)
				}
			} catch (error) {
				logDebug(config.debug, 'Failed to load chat history:', error)
			}
		}
	}, [config])

	/**
	 * Close AI chat
	 */
	const handleChatClose = useCallback(() => {
		signals.setAIChatOpen(false)
	}, [])

	/**
	 * Cancel in-progress AI request
	 */
	const handleChatCancel = useCallback(() => {
		aiService.abort()
		signals.setAIProcessing(false)
		signals.clearAIStatus()
		// Clean up empty assistant message
		const messages = signals.chatMessages.value
		const lastMsg = messages[messages.length - 1]
		if (lastMsg?.role === 'assistant' && !lastMsg.content.trim()) {
			signals.setChatMessages(messages.filter((m) => m.id !== lastMsg.id))
		}
	}, [aiService])

	/**
	 * Handle AI prompt submission from tooltip
	 */
	const handleTooltipPromptSubmit = useCallback(
		async (prompt: string, elementId: string) => {
			const change = signals.getPendingChange(elementId)
			if (!change) {
				showToast('Element not found', 'error')
				return
			}

			const currentContent = getEditableTextFromElement(change.element)
			const manifest = signals.manifest.value

			signals.setAIProcessing(true)

			logDebug(
				config.debug,
				'Tooltip AI request for element:',
				elementId,
				'prompt:',
				prompt,
			)

			try {
				await aiService.streamRequest(
					{
						prompt,
						elementId,
						currentContent,
						context: getManifestEntry(manifest, elementId)?.sourcePath,
					},
					{
						onToken: (_token, fullText) => {
							change.element.textContent = fullText
						},
						onComplete: (finalText) => {
							logDebug(config.debug, 'Tooltip AI completed:', finalText)
							change.element.textContent = finalText
							handleElementChange(
								config,
								elementId,
								change.element,
								onUIUpdate,
							)

							signals.setAIProcessing(false)
							onTooltipHide()
							showToast('AI edit applied', 'success')
						},
						onError: (error) => {
							logDebug(config.debug, 'Tooltip AI error:', error)
							signals.setAIProcessing(false)
							showToast(`AI error: ${error.message}`, 'error')
						},
					},
				)
			} catch (error) {
				signals.setAIProcessing(false)
				showToast('AI request failed', 'error')
			}
		},
		[config, aiService, showToast, onTooltipHide, onUIUpdate],
	)

	/**
	 * Handle chat message send
	 */
	const handleChatSend = useCallback(
		async (message: string, elementId?: string) => {
			const userMessage: ChatMessage = {
				id: nextMessageId('user'),
				role: 'user',
				content: message,
				elementId,
				timestamp: Date.now(),
			}
			signals.addChatMessage(userMessage)

			const assistantMessageId = nextMessageId('assistant')
			const assistantMessage: ChatMessage = {
				id: assistantMessageId,
				role: 'assistant',
				content: '',
				elementId,
				timestamp: Date.now(),
			}

			signals.setAIProcessing(true)
			signals.clearAIStatus()

			const manifest = signals.manifest.value
			const componentInstance = elementId ? getComponentInstance(manifest, elementId) : null

			let currentContent: string | undefined
			let context: string | undefined

			if (componentInstance) {
				// Component context: send component name, props, and source file
				currentContent = JSON.stringify({
					component: componentInstance.componentName,
					props: componentInstance.props,
				})
				context = componentInstance.file
			} else {
				const entry = elementId ? getManifestEntry(manifest, elementId) : null
				const parentComponent = entry?.parentComponentId
					? getComponentInstance(manifest, entry.parentComponentId)
					: null

				const change = elementId ? signals.getPendingChange(elementId) : null
				currentContent = change
					? getEditableTextFromElement(change.element)
					: undefined
				// Use the entry's source file, or fall back to parent component's file
				context = entry?.sourcePath
					?? parentComponent?.file
					?? undefined
			}

			const handleAction = (action: CmsAiAction) => {
				logDebug(config.debug, 'AI action received:', action)
				if (action.name === 'preview' && action.url) {
					// Open preview in new tab
					window.open(action.url, '_blank')
				} else if (action.name === 'refresh') {
					// Refresh the current page to show new content
					window.location.reload()
				}
			}

			let hasStarted = false

			try {
				await aiService.streamRequest(
					{
						prompt: message,
						elementId: elementId || '',
						currentContent: currentContent || '',
						context,
					},
					{
						onStart: () => {
							if (!hasStarted) {
								signals.addChatMessage(assistantMessage)
								hasStarted = true
							}
						},
						onToken: (_token, fullText) => {
							if (!hasStarted) {
								signals.addChatMessage(assistantMessage)
								hasStarted = true
							}
							// Update the message content using the new helper
							signals.updateChatMessage(assistantMessageId, fullText)
						},
						onStatus: (status, statusMessage) => {
							// Map SSE status strings to AIStatusType
							const statusMap: Record<string, AIStatusType> = {
								thinking: 'thinking',
								coding: 'coding',
								building: 'building',
								deploying: 'deploying',
								complete: 'complete',
							}
							const mappedStatus = statusMap[status] ?? null
							signals.setAIStatus(mappedStatus, statusMessage)
						},
						onAction: handleAction,
						onComplete: (finalText) => {
							if (hasStarted && !finalText.trim()) {
								// Remove empty assistant message instead of leaving an empty bubble
								signals.setChatMessages(
									signals.chatMessages.value.filter((m) => m.id !== assistantMessageId),
								)
							} else {
								signals.updateChatMessage(assistantMessageId, finalText)
							}
							signals.setAIProcessing(false)
							signals.clearAIStatus()
						},
						onError: (error) => {
							// Remove empty assistant message, keep if it has partial content
							const msg = signals.chatMessages.value.find((m) => m.id === assistantMessageId)
							if (msg && !msg.content.trim()) {
								signals.setChatMessages(
									signals.chatMessages.value.filter((m) => m.id !== assistantMessageId),
								)
							}
							signals.setAIProcessing(false)
							signals.clearAIStatus()
							showToast(`AI error: ${error.message}`, 'error')
						},
					},
				)
			} catch (error) {
				if (hasStarted) {
					// Remove the empty assistant message if no content was received
					const msg = signals.chatMessages.value.find((m) => m.id === assistantMessageId)
					if (msg && !msg.content.trim()) {
						signals.setChatMessages(
							signals.chatMessages.value.filter((m) => m.id !== assistantMessageId),
						)
					}
				}
				signals.setAIProcessing(false)
				signals.clearAIStatus()
				showToast('AI request failed', 'error')
			}
		},
		[config, aiService, showToast],
	)

	/**
	 * Apply chat content to an element
	 */
	const handleApplyToElement = useCallback(
		(content: string, elementId: string) => {
			const change = signals.getPendingChange(elementId)
			if (!change) {
				showToast('Element not found', 'error')
				return
			}

			change.element.textContent = content
			handleElementChange(config, elementId, change.element, onUIUpdate)
			showToast('Content applied to element', 'success')
		},
		[config, showToast, onUIUpdate],
	)

	return {
		aiService,
		handleAIChatToggle,
		handleChatClose,
		handleChatCancel,
		handleTooltipPromptSubmit,
		handleChatSend,
		handleApplyToElement,
	}
}
