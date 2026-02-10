import { type CmsAiAction, type CmsAiChatRequest, type CmsAiStreamCallbacks, streamAiChat } from './api'
import { logDebug } from './dom'
import type { CmsConfig, ComponentProp } from './types'

// Re-export for consumers
export type { CmsAiAction }

export interface AIRequest {
	prompt: string
	elementId: string
	currentContent: string
	context?: string
}

export interface AIBlockPropsRequest {
	prompt: string
	componentName: string
	props: ComponentProp[]
	currentValues: Record<string, unknown>
	context?: string
}

export interface AIStreamCallbacks {
	onStart?: () => void
	onToken?: (token: string, fullText: string) => void
	onComplete?: (finalText: string) => void
	onError?: (error: Error) => void
	/** Called when AI provides status updates (thinking, coding, building, deploying) */
	onStatus?: (status: string, message?: string) => void
	/** Called when AI requests an action (refresh page, show preview, apply edit) */
	onAction?: (action: CmsAiAction) => void
}

export interface AIConfig {
	endpoint: string
	headers?: Record<string, string>
}

export function getAIConfig(config: CmsConfig): AIConfig {
	return {
		endpoint: config.apiBase,
		headers: {
			'Content-Type': 'application/json',
		},
	}
}

export class AIService {
	private config: CmsConfig
	private aiConfig: AIConfig
	private abortController: AbortController | null = null

	constructor(config: CmsConfig) {
		this.config = config
		this.aiConfig = getAIConfig(config)
	}

	/**
	 * Stream AI chat request using rich SSE events
	 * Supports status updates, actions (refresh, preview), and streaming text
	 */
	async streamRequest(request: AIRequest, callbacks: AIStreamCallbacks): Promise<void> {
		this.abortController = new AbortController()
		let fullText = ''

		callbacks.onStart?.()

		const chatRequest: CmsAiChatRequest = {
			prompt: request.prompt,
			elementId: request.elementId,
			currentContent: request.currentContent,
			context: request.context,
			pageUrl: window.location.href,
		}

		const streamCallbacks: CmsAiStreamCallbacks = {
			onToken: (token, accumulatedText) => {
				fullText = accumulatedText
				callbacks.onToken?.(token, accumulatedText)
			},
			onStatus: (status, message) => {
				logDebug(this.config.debug, 'AI status:', status, message)
				callbacks.onStatus?.(status, message)
			},
			onAction: action => {
				logDebug(this.config.debug, 'AI action:', action)
				callbacks.onAction?.(action)
			},
			onError: (error, code) => {
				logDebug(this.config.debug, 'AI error:', error, code)
				callbacks.onError?.(new Error(error))
			},
			onDone: summary => {
				logDebug(this.config.debug, 'AI done:', summary)
				callbacks.onComplete?.(fullText)
			},
		}

		try {
			await streamAiChat(
				this.aiConfig.endpoint,
				chatRequest,
				streamCallbacks,
				this.abortController.signal,
			)
		} catch (error) {
			callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
		} finally {
			this.abortController = null
		}
	}

	abort(): void {
		if (this.abortController) {
			this.abortController.abort()
			this.abortController = null
		}
	}

	isStreaming(): boolean {
		return this.abortController !== null
	}

	/**
	 * Generate prop values for a component using AI
	 */
	async generateBlockProps(request: AIBlockPropsRequest): Promise<Record<string, unknown>> {
		try {
			const response = await fetch(`${this.aiConfig.endpoint}/ai/generate-props`, {
				method: 'POST',
				credentials: 'include',
				headers: this.aiConfig.headers,
				body: JSON.stringify({
					prompt: request.prompt,
					componentName: request.componentName,
					props: request.props,
					currentValues: request.currentValues,
					context: request.context,
					pageUrl: window.location.href,
				}),
			})

			if (!response.ok) {
				throw new Error(`AI request failed: ${response.status} ${response.statusText}`)
			}

			const result = await response.json()
			return result.props || {}
		} catch (error) {
			logDebug(this.config.debug, 'AI generateBlockProps error:', error)
			throw error
		}
	}

	/**
	 * Suggest the best component to use based on user intent
	 */
	async suggestComponent(
		prompt: string,
		availableComponents: Array<{ name: string; description?: string; props: ComponentProp[] }>,
	): Promise<{ componentName: string; suggestedProps: Record<string, unknown> } | null> {
		try {
			const response = await fetch(`${this.aiConfig.endpoint}/ai/suggest-component`, {
				method: 'POST',
				credentials: 'include',
				headers: this.aiConfig.headers,
				body: JSON.stringify({
					prompt,
					availableComponents,
					pageUrl: window.location.href,
				}),
			})

			if (!response.ok) {
				throw new Error(`AI request failed: ${response.status} ${response.statusText}`)
			}

			const result = await response.json()
			return result.suggestion || null
		} catch (error) {
			logDebug(this.config.debug, 'AI suggestComponent error:', error)
			throw error
		}
	}
}
