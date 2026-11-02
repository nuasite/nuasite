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

/** The submitted field names, without the honeypot and token fields that `isInternal` picks out. */
export function trackedFields(entries: Iterable<[string, unknown]>, isInternal: (name: string) => boolean): TrackedFields {
	const fields: TrackedFields = {}
	for (const [name] of entries) {
		if (!isInternal(name)) fields[name] = ''
	}
	return fields
}

/**
 * The reason recorded for a response the server did not accept. Built from the status alone: the
 * server's error text can quote what was submitted, such as the name of a file that was too large.
 */
export function responseErrorReason(status: number): string {
	return `http_${status}`
}

/** The reason recorded when the request never got a response. The error's message is not sent. */
export const networkErrorReason = 'network_error'
