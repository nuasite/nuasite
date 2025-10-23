export type PageMeta = {
	route: string
	title: string
	description: string
	headlines: { level: string; text: string }[]
}

export type RedirectMeta = {
	from: string
	to: string
	status: string
}
