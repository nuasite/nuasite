/**
 * React node-view for the `youtube` node: a live embed. Shows the video thumbnail
 * with a play button and lazily swaps in the iframe on click (lite-embed pattern —
 * no iframe network/CPU cost until the user actually plays). Mirrors the per-node
 * React root + `$view` wiring used by `createMdxComponentView`.
 */
import type { Node as PmNode } from '@milkdown/prose/model'
import { $view } from '@milkdown/utils'
import { createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { youtubeNode } from './youtube-plugin'

const wrap: React.CSSProperties = {
	position: 'relative',
	width: '100%',
	maxWidth: 560,
	aspectRatio: '16 / 9',
	margin: '0.5rem 0',
	borderRadius: 8,
	overflow: 'hidden',
	background: '#000',
	border: '1px solid rgba(0,0,0,0.1)',
}
const thumb: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }
const playBtn: React.CSSProperties = {
	position: 'absolute',
	inset: 0,
	margin: 'auto',
	width: 68,
	height: 48,
	border: 'none',
	borderRadius: 12,
	background: 'rgba(0,0,0,0.7)',
	color: '#fff',
	fontSize: 22,
	cursor: 'pointer',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
}
const removeBtn: React.CSSProperties = {
	position: 'absolute',
	top: 6,
	right: 6,
	zIndex: 2,
	width: 24,
	height: 24,
	border: 'none',
	borderRadius: 6,
	background: 'rgba(0,0,0,0.6)',
	color: '#fff',
	cursor: 'pointer',
	lineHeight: '24px',
}
const iframeStyle: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }
const placeholder: React.CSSProperties = { ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13 }

interface YoutubeCardProps {
	videoId: string
	onRemove: () => void
}

function YoutubeCard({ videoId, onRemove }: YoutubeCardProps) {
	const [playing, setPlaying] = useState(false)

	if (!videoId) {
		return createElement('div', { style: placeholder, 'data-cms-ui': '' }, 'YouTube: missing video id')
	}

	const remove = createElement('button', {
		type: 'button',
		style: removeBtn,
		title: 'Remove',
		'data-mdx-action': 'youtube-remove',
		onClick: onRemove,
	}, '✕')

	if (playing) {
		return createElement(
			'div',
			{ style: wrap, 'data-cms-ui': '' },
			remove,
			createElement('iframe', {
				style: iframeStyle,
				src: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`,
				title: 'YouTube video',
				allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
				allowFullScreen: true,
			}),
		)
	}

	return createElement(
		'div',
		{ style: wrap, 'data-cms-ui': '' },
		remove,
		createElement('img', {
			style: thumb,
			src: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
			alt: 'YouTube thumbnail',
			loading: 'lazy',
			onClick: () => setPlaying(true),
		}),
		createElement('button', {
			type: 'button',
			style: playBtn,
			title: 'Play',
			'data-mdx-action': 'youtube-play',
			onClick: () => setPlaying(true),
		}, '▶'),
	)
}

export function createYoutubeView() {
	return $view(youtubeNode, () => {
		return (pmNode, view, getPos) => {
			const container = document.createElement('div')
			container.setAttribute('data-cms-ui', '')
			container.contentEditable = 'false'
			const root: Root = createRoot(container)

			let lastVideoId: string | null = null

			const removeNode = () => {
				const pos = typeof getPos === 'function' ? getPos() : null
				if (pos == null) return
				const currentNode = view.state.doc.nodeAt(pos)
				if (!currentNode) return
				view.dispatch(view.state.tr.delete(pos, pos + currentNode.nodeSize))
			}

			const renderCard = (node: PmNode) => {
				const videoId = node.attrs.videoId as string
				container.setAttribute('data-youtube', videoId)
				lastVideoId = videoId
				root.render(createElement(YoutubeCard, { videoId, onRemove: removeNode }))
			}

			renderCard(pmNode)

			return {
				dom: container,
				stopEvent: (event: Event) => {
					const target = event.target as HTMLElement
					if (target.closest('[data-mdx-action]') || target.tagName === 'IFRAME' || target.tagName === 'IMG') return true
					if (event.type === 'mousedown' || event.type === 'click') return Boolean(target.closest('button'))
					return false
				},
				ignoreMutation: () => true,
				update: (updatedNode: PmNode) => {
					if (updatedNode.type.name !== 'youtube') return false
					if (lastVideoId === updatedNode.attrs.videoId) return true
					renderCard(updatedNode)
					return true
				},
				destroy: () => {
					queueMicrotask(() => root.unmount())
				},
			}
		}
	})
}
