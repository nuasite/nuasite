const VIDEO_TYPES: Record<string, string> = {
	mp4: 'video/mp4',
	webm: 'video/webm',
}

/** The `<source type>` for a video URL, so the browser can skip a format it cannot play without fetching it. */
export function videoTypeOf(src: string): string | undefined {
	const path = src.split(/[?#]/)[0] ?? ''
	const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
	return VIDEO_TYPES[extension]
}
