/** @jsxImportSource preact */

interface Rect {
	x: number
	y: number
	width: number
	height: number
}

interface ElementHighlightProps {
	rect: Rect | null
	persistent?: boolean
}

/**
 * A non-interactive ring drawn over a target element. The Preact root sits
 * inside a shadow DOM mounted to `<body>`, so we use viewport-fixed
 * positioning to align with the target's `getBoundingClientRect()`.
 */
export function ElementHighlight({ rect, persistent }: ElementHighlightProps) {
	if (!rect) return null
	return (
		<div
			class={`notes-highlight ${persistent ? 'notes-highlight--persistent' : ''}`}
			style={{
				left: `${rect.x}px`,
				top: `${rect.y}px`,
				width: `${rect.width}px`,
				height: `${rect.height}px`,
			}}
		/>
	)
}
