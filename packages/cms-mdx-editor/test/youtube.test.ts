import { expect, test } from 'bun:test'
import { extractYoutubeId } from '../src/youtube'

const ID = 'dQw4w9WgXcQ'

test('returns a bare 11-char id unchanged', () => {
	expect(extractYoutubeId(ID)).toBe(ID)
	expect(extractYoutubeId(`  ${ID}  `)).toBe(ID)
})

test('extracts id from watch URLs', () => {
	expect(extractYoutubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID)
	expect(extractYoutubeId(`https://youtube.com/watch?v=${ID}&t=30s`)).toBe(ID)
	expect(extractYoutubeId(`https://www.youtube.com/watch?list=PL123&v=${ID}`)).toBe(ID)
})

test('extracts id from short and embed URLs', () => {
	expect(extractYoutubeId(`https://youtu.be/${ID}`)).toBe(ID)
	expect(extractYoutubeId(`https://youtu.be/${ID}?si=abc`)).toBe(ID)
	expect(extractYoutubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID)
	expect(extractYoutubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID)
})

test('returns null when no id can be found', () => {
	expect(extractYoutubeId('')).toBeNull()
	expect(extractYoutubeId('   ')).toBeNull()
	expect(extractYoutubeId('https://example.com/not-a-video')).toBeNull()
	expect(extractYoutubeId('not an id')).toBeNull()
})
