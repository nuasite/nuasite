import { describe, expect, test } from 'bun:test'
import { mergeRedirects, parseRedirectRule } from '../src/redirects'

const rules = (text: string) => text.split('\n').filter(l => l && !l.startsWith('#'))

describe('mergeRedirects', () => {
	// What took ochrance.cz's deploy down: a path redirected in code and again by an editor, the CMS
	// rule appended below a pattern that already matched it. Cloudflare rejects the repeat outright.
	test('a path redirected by the CMS and in code is listed once, with the CMS rule, above the patterns', () => {
		const merged = mergeRedirects([
			{ name: 'cms', text: '/letaky/a/a.pdf /uploads/new.pdf\n' },
			{ name: 'public', text: '/letaky/a/a.pdf https://cdn.example/a.pdf 301\n/letaky/:slug/:file https://cdn.example/:slug/:file 301\n' },
		])

		expect(rules(merged.text)).toEqual(['/letaky/a/a.pdf /uploads/new.pdf', '/letaky/:slug/:file https://cdn.example/:slug/:file 301'])
		expect(merged.overridden).toEqual([{
			kept: { layer: 'cms', lineNumber: 1, line: '/letaky/a/a.pdf /uploads/new.pdf' },
			dropped: { layer: 'public', lineNumber: 1, line: '/letaky/a/a.pdf https://cdn.example/a.pdf 301' },
		}])
	})

	test('each layer is a block ahead of the layers it overrides, so it wins by a pattern too', () => {
		const merged = mergeRedirects([
			{ name: 'cms', text: '/blog/* /novy/:splat 301\n' },
			{ name: 'public', text: '/blog/x /old 301\n/c /d 301\n' },
			{ name: 'config', text: '/e /f 307\n/g/* /h/:splat 301\n' },
		])

		// `/blog/x` would match the CMS pattern first at the host, as the editor asked.
		expect(rules(merged.text)).toEqual(['/blog/* /novy/:splat 301', '/blog/x /old 301', '/c /d 301', '/e /f 307', '/g/* /h/:splat 301'])
		expect(merged.counts).toEqual({ exact: 3, pattern: 2 })
		expect(mergeRedirects([{ name: 'x', text: '/blog-:slug /posts/:slug\n' }]).counts).toEqual({ exact: 0, pattern: 1 })
	})

	test('the order within a hand-written file is kept, conditions included', () => {
		const text = '/* /cs/:splat 302 Language=cs\n/ /en 302\n/old /new 301\n'
		expect(rules(mergeRedirects([{ name: 'public', text }]).text)).toEqual(rules(text))
	})

	test('a repeat of the very same rule is dropped without being reported as overridden', () => {
		const merged = mergeRedirects([{ name: 'a', text: '/x /y 301\n' }, { name: 'b', text: '/x   /y   301\n' }])

		expect(rules(merged.text)).toEqual(['/x /y 301'])
		expect(merged.overridden).toEqual([])
	})

	test('Netlify rules for one source that differ by condition or query stay apart', () => {
		const text = '/ /cs 302 Language=cs\n/ /en 302 Language=en\n/ /en 302\n/store id=:id /blog/:id 301\n/store /shop 301\n'
		const merged = mergeRedirects([{ name: 'public', text }])

		expect(rules(merged.text)).toEqual(rules(text))
		expect(merged.overridden).toEqual([])
	})

	// A Netlify role gate has no destination, and a host may accept forms this reader does not know.
	// Dropping such a line could take an access rule off the site, so it stays where it was.
	test('a line not read as a rule is kept as written, where it was', () => {
		const text = '/admin/*  200!  Role=admin\n/admin/* /login 401!\n/note /x 301 # why\n'
		const merged = mergeRedirects([{ name: 'public', text }])

		expect(merged.lines).toEqual(['/admin/*  200!  Role=admin', '/admin/* /login 401!', '/note /x 301 # why'])
		expect(merged.unrecognised.map(l => l.lineNumber)).toEqual([1, 3])
	})

	test('an exact rule a pattern from higher up reaches first is reported as never reached', () => {
		const merged = mergeRedirects([
			{ name: 'public', text: '/blog/* /news/:splat 301\n/lang/* /cs/:splat 302 Language=cs\n' },
			{ name: 'config', text: '/blog/old /archive/old 307\n/lang/x /y 307\n/other /z 307\n' },
		])

		// A conditional pattern may not apply, so `/lang/x` is not reported.
		expect(merged.shadowed).toEqual([{
			by: { layer: 'public', lineNumber: 1, line: '/blog/* /news/:splat 301' },
			rule: { layer: 'config', lineNumber: 1, line: '/blog/old /archive/old 307' },
		}])
	})

	test('merging a merged file with its own rules changes nothing', () => {
		const once = mergeRedirects([
			{ name: 'cms', text: '/a /b\n/p/* /q/:splat\n' },
			{ name: 'public', text: '# comment\n/a /c 301\n/d  /e\n' },
		])
		const twice = mergeRedirects([{ name: 'cms', text: '/a /b\n/p/* /q/:splat\n' }, { name: 'built', text: once.text }])

		expect(twice.text).toBe(once.text)
		expect(twice.overridden).toEqual([])
	})

	test('no rules anywhere yields no file', () => {
		expect(mergeRedirects([{ name: 'a', text: '# only a comment\n\n' }, { name: 'b', text: '' }]).text).toBe('')
	})
})

describe('parseRedirectRule', () => {
	test('reads source, query matches, destination, status and conditions', () => {
		expect(parseRedirectRule('/store id=:id /blog/:id 301! Country=cz')).toMatchObject({
			source: '/store',
			destination: '/blog/:id',
			status: '301!',
			conditions: ['id=:id', 'Country=cz'],
			key: '/store Country=cz id=:id',
		})
	})

	test('a line with a stray field is not a rule', () => {
		for (const line of ['/u /v 301 # note', '/s /a b', '/a 301', '/a http:example.com', '/a /b 30', '/a /b 3011']) {
			expect(parseRedirectRule(line)).toBeUndefined()
		}
	})
})

describe('a restricted layer', () => {
	const code = {
		name: 'public',
		text: '/admin/*  200!  Role=admin\n/admin/* /login 401!\n/private/* /404 404\n/files/x.pdf https://cdn.example/x.pdf 200\n/a /b 301\n',
	}
	const merge = (cms: string) => mergeRedirects([{ name: 'cms', text: cms, restricted: true }, code])

	test('may redirect a path code redirects or rewrites too, and wins', () => {
		const merged = merge('/a /c\n/files/x.pdf /uploads/new.pdf\n')
		expect(merged.lines.slice(0, 2)).toEqual(['/a /c', '/files/x.pdf /uploads/new.pdf'])
		expect(merged.refused).toEqual([])
	})

	test('may not proxy, gate or use conditions', () => {
		for (const line of ['/x /y 200', '/x /y 404', '/x /y 301 Role=admin', '/x  200!  Role=admin']) {
			expect(merge(line).refused.map(r => r.rule.line)).toEqual([line])
		}
	})

	test('may not touch a path a guard from code covers, from either side', () => {
		for (const line of ['/admin/* /open 301', '/admin/panel /x 301', '/* /elsewhere 301', '/private/report /x 301']) {
			const merged = merge(line)
			expect(merged.refused.map(r => r.rule.line)).toEqual([line])
			expect(merged.lines).not.toContain(line)
		}
	})

	// Hosts compare paths more loosely than a regular expression would: a guard must not be passed
	// by spelling its path another way, nor by a placeholder that the guard's pattern cannot see.
	test('cannot reach a guarded path by case, encoding, slashes or a placeholder', () => {
		for (const source of ['/Admin/panel', '/ADMIN/*', '/admin', '/admin//panel/', '/%61dmin/panel', '/:section/panel', '/:only']) {
			expect(merge(`${source} /x 301\n`).refused.map(r => r.rule.line)).toEqual([`${source} /x 301`])
		}
	})

	test('a path no guard covers stays allowed', () => {
		for (const source of ['/', '/blog/admin', '/administrace', '/blog/:slug']) {
			expect(merge(`${source} /x 301\n`).refused).toEqual([])
		}
	})
})
