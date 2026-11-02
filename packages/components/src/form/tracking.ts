/**
 * What a submission tells `window.analytics.form`: which fields it had and why it failed, never what
 * the visitor typed. Field values are personal data (names, e-mails, messages, uploaded file names),
 * and once they reach an analytics store nobody can delete them.
 *
 * The tracker takes `formData` as a `{ name: value }` object and the current one sends only its keys.
 * Every value here is empty, so a tracker that still sends values (a cached script, a site's own
 * `window.analytics`) has nothing to send either.
 */
import { cssTrapSelector, honeypotFields } from './utils.ts'

export type TrackedFields = Record<string, ''>

/**
 * The fields the component renders itself and the visitor never fills in: the named honeypots (a
 * fixed list), the token (by its name) and the CSS honeypot (by its style, since its random name is
 * not on the page). Read from the component's own code and markup, not from attributes a site's
 * props could set, and not from `aria-hidden`, which UI libraries put on real fields too.
 */
export function internalFieldNames(form: HTMLFormElement, tokenFieldName: string | undefined): Set<string> {
	const names = new Set<string>(honeypotFields.map(field => field.name))
	if (tokenFieldName) names.add(tokenFieldName)
	const cssTrap = form.querySelector<HTMLInputElement>(cssTrapSelector)
	if (cssTrap?.name) names.add(cssTrap.name)
	return names
}

/** The names of the submitted fields, without the internal ones (honeypots, token). */
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
