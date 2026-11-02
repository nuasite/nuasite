/**
 * What a submission tells `window.analytics.form`: which fields it had and why it failed, never what
 * the visitor typed. Field values are personal data (names, e-mails, messages, uploaded file names),
 * and once they reach an analytics store nobody can delete them.
 *
 * The tracker takes `formData` as a `{ name: value }` object and the current one sends only its keys.
 * Every value here is empty, so a tracker that still sends values (a cached script, a site's own
 * `window.analytics`) has nothing to send either.
 */
export type TrackedFields = Record<string, ''>

/**
 * Fields the component adds itself and the visitor never sees: the honeypots, the token, and any
 * `aria-hidden` input (the CSS honeypot, whose name is random).
 */
export function internalFieldNames(form: HTMLFormElement, honeypotNames: readonly string[], tokenFieldName: string | undefined): Set<string> {
	const names = new Set(honeypotNames)
	if (tokenFieldName) names.add(tokenFieldName)
	for (const field of form.querySelectorAll<HTMLInputElement>('[name][aria-hidden="true"]')) names.add(field.name)
	return names
}

/** The names of the submitted fields, without the internal ones. */
export function trackedFields(entries: Iterable<[string, unknown]>, internal: ReadonlySet<string>): TrackedFields {
	const fields: TrackedFields = {}
	for (const [name] of entries) {
		if (!internal.has(name)) fields[name] = ''
	}
	return fields
}

/**
 * The reason recorded for a response the form did not accept. Built from the status alone: the
 * server's error text can quote what was submitted, such as the name of a file that was too large.
 * A 2xx answer without `success` gets its own code, so it does not read as a successful status.
 */
export function responseErrorReason(response: Pick<Response, 'ok' | 'status'>): string {
	return response.ok ? 'not_accepted' : `http_${response.status}`
}
