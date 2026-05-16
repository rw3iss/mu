import path from 'node:path';

const YEAR_REGEX = /(?:^|[\s._\-([])(19\d{2}|20\d{2})(?:[\s._\-)\]]|$)/;

/**
 * Extract a release year from a filename / folder name. Looks for a
 * 4-digit year (1900–2099) sandwiched by typical separators or
 * brackets, e.g. `(2019)`, `.2019.`, `[2019]`, ` 2019 `. Returns the
 * first match found or null.
 */
export function extractYearFromString(input: string): number | null {
	if (!input) return null;
	const m = YEAR_REGEX.exec(input);
	if (!m) return null;
	const y = parseInt(m[1]!, 10);
	if (Number.isNaN(y)) return null;
	if (y < 1900 || y > 2099) return null;
	return y;
}

/**
 * Best-effort year extraction with fallback chain:
 *   1. The movie's stored `year` if non-null and plausible.
 *   2. The file's basename (most reliable — release groups embed year here).
 *   3. The parent folder name (some libraries put year on the folder).
 *
 * Returns null if no year is recoverable.
 */
export function extractYear(opts: {
	storedYear?: number | null;
	filePath?: string | null;
	folderPath?: string | null;
}): number | null {
	const { storedYear, filePath, folderPath } = opts;
	if (storedYear && storedYear >= 1900 && storedYear <= 2099) return storedYear;

	if (filePath) {
		const base = path.basename(filePath);
		const fromFile = extractYearFromString(base);
		if (fromFile) return fromFile;
	}

	if (folderPath) {
		const fromFolder = extractYearFromString(path.basename(folderPath));
		if (fromFolder) return fromFolder;
	}

	if (filePath) {
		// Walk one level up from the file as a fallback.
		const parent = path.dirname(filePath);
		const fromParent = extractYearFromString(path.basename(parent));
		if (fromParent) return fromParent;
	}

	return null;
}
