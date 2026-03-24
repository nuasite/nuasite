/**
 * Locale-keyed collections of generic/non-descriptive text patterns.
 * Used by accessibility and SEO checks to detect poor link text and image alt text.
 */

export const poorLinkTexts: Record<string, string[]> = {
	en: ['click here', 'read more', 'here', 'link', 'more', 'learn more'],
	es: ['haz clic aquí', 'clic aquí', 'leer más', 'aquí', 'enlace', 'más', 'más información'],
	fr: ['cliquez ici', 'lire la suite', 'en savoir plus', 'ici', 'lien', 'plus'],
	de: ['hier klicken', 'klicken sie hier', 'mehr lesen', 'weiterlesen', 'hier', 'mehr', 'mehr erfahren'],
	it: ['clicca qui', 'leggi di più', 'continua a leggere', 'qui', 'collegamento', 'più'],
	pt: ['clique aqui', 'leia mais', 'saiba mais', 'aqui', 'mais'],
	nl: ['klik hier', 'lees meer', 'meer'],
	cs: ['klikněte zde', 'klikni zde', 'čtěte dále', 'více', 'zde', 'odkaz', 'zjistit více'],
	ko: ['여기를 클릭', '더 보기', '자세히 보기', '여기', '링크', '더보기', '클릭'],
}

export const poorImageAlts: Record<string, string[]> = {
	en: ['image', 'photo', 'picture', 'img', 'untitled', 'screenshot', 'banner', 'logo', 'icon', 'graphic', 'thumbnail'],
	es: ['imagen', 'foto', 'fotografía', 'captura de pantalla', 'logotipo', 'ícono'],
	fr: ['image', 'photo', "capture d'écran", 'logo', 'icône', 'graphique', 'vignette'],
	de: ['bild', 'foto', 'grafik', 'bildschirmfoto', 'logo', 'symbol'],
	it: ['immagine', 'foto', 'fotografia', 'schermata', 'logo', 'icona'],
	pt: ['imagem', 'foto', 'fotografia', 'captura de tela', 'logotipo', 'ícone'],
	nl: ['afbeelding', 'foto', 'schermafbeelding', 'logo', 'icoon'],
	cs: ['obrázek', 'foto', 'fotografie', 'snímek obrazovky', 'logo', 'ikona'],
	ko: ['이미지', '사진', '스크린샷', '로고', '아이콘', '그래픽', '썸네일'],
}

const cache = new WeakMap<Record<string, string[]>, Map<string, Set<string>>>()

/**
 * Build a Set of poor texts, optionally filtered by page locale.
 * When a locale is provided, returns texts for that language + English as fallback.
 * When no locale is provided or locale is unrecognized, returns English texts only.
 * Results are cached by dictionary + locale.
 */
export function buildPoorTextSet(texts: Record<string, string[]>, locale?: string): Set<string> {
	const key = locale?.toLowerCase().split('-')[0] ?? '*'

	let localeMap = cache.get(texts)
	if (!localeMap) {
		localeMap = new Map()
		cache.set(texts, localeMap)
	}

	const cached = localeMap.get(key)
	if (cached) return cached

	const en = texts.en ?? []
	let result: Set<string>

	if (key === '*') {
		const set = new Set<string>()
		for (const arr of Object.values(texts)) {
			for (const s of arr) set.add(s)
		}
		result = set
	} else {
		const matched = texts[key]
		result = matched ? new Set([...matched, ...en]) : new Set(en)
	}

	localeMap.set(key, result)
	return result
}
