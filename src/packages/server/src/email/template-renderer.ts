/**
 * Minimal, dependency-free email template renderer. Templates are plain HTML
 * strings with `{{key}}` (HTML-escaped) and `{{{key}}}` (raw, for pre-built safe
 * HTML like newline→<br> bodies) placeholders. Callers pass a flat string map
 * derived from a typed object, so each template has a strict known input shape.
 */
export function escapeHtml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Escape, then turn newlines into <br> — for multi-line user text in HTML. */
export function escapeMultiline(input: string): string {
	return escapeHtml(input).replace(/\r?\n/g, '<br />');
}

export function renderTemplate(template: string, data: Record<string, string>): string {
	return template
		.replace(/\{\{\{(\w+)\}\}\}/g, (_, key: string) => data[key] ?? '')
		.replace(/\{\{(\w+)\}\}/g, (_, key: string) => escapeHtml(data[key] ?? ''));
}
