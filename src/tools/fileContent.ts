import type { ImageInfo } from 'mwn';

/** The content forms a model can consume, derived from the file's MIME type. */
export type FileContentForm = 'image' | 'source';

export type FileContentFormat = 'auto' | FileContentForm | 'both';

const TEXT_SOURCE_MIMES = new Set([
	'application/ecmascript',
	'application/javascript',
	'application/json',
	'application/xhtml+xml',
	'application/xml',
	'application/x-javascript',
]);

export function isSvgMime(mime: string | undefined): boolean {
	return mime === 'image/svg+xml';
}

export function isPdfMime(mime: string | undefined): boolean {
	return mime === 'application/pdf';
}

export function isTextSourceMime(mime: string | undefined): boolean {
	if (mime === undefined) {
		return false;
	}
	return mime.startsWith('text/') || TEXT_SOURCE_MIMES.has(mime);
}

export function isRasterImageMime(mime: string | undefined): boolean {
	return mime !== undefined && mime.startsWith('image/') && !isSvgMime(mime);
}

/**
 * Every form `get-file-content` can return for this file on this server.
 *
 * - SVG is rasterised server-side and its XML is readable, so both forms exist.
 * - Raster images have no text source.
 * - PDFs have extracted text; they have no raster unless the wiki renders them.
 * - Text-like files have a source only.
 */
export function contentFormatsFor(mime: string | undefined): FileContentForm[] {
	if (mime === undefined) {
		return [];
	}
	if (isSvgMime(mime)) {
		return ['image', 'source'];
	}
	if (isRasterImageMime(mime)) {
		return ['image'];
	}
	if (isPdfMime(mime) || isTextSourceMime(mime)) {
		return ['source'];
	}
	return [];
}

/**
 * Resolve `format` against the forms the file actually supports.
 *
 * `auto` is the zero-choice path: an image when the file has one, otherwise the
 * source. Explicit requests are validated with a message that names the forms
 * the caller can use, so a mismatch does not send the model into a retry loop.
 * `both` never fails for a file with at least one form; it returns what exists.
 */
export function selectForms(
	format: FileContentFormat,
	mime: string | undefined,
): { forms: FileContentForm[] } | { error: string } {
	const supported = contentFormatsFor(mime);
	const supportedLabel = supported.length > 0 ? supported.join(', ') : 'none';

	if (supported.length === 0) {
		return {
			error:
				`File type "${mime ?? 'unknown'}" has no model-consumable form. ` +
				'Use get-file-info for metadata and the download URL.',
		};
	}

	if (format === 'auto') {
		return { forms: supported.includes('image') ? ['image'] : ['source'] };
	}
	if (format === 'both') {
		return { forms: supported };
	}
	if (!supported.includes(format)) {
		return {
			error: `File type "${mime ?? 'unknown'}" has no ${format} form. Supported formats: ${supportedLabel}.`,
		};
	}
	return { forms: [format] };
}

/** The URL whose bytes carry a requested form. */
export function sourceUrlFor(info: ImageInfo, forms: FileContentForm[]): string | undefined {
	// A thumburl is a rendition of the file (a raster for an image, a JPEG for a
	// PDF with PdfHandler). It is not the file's own bytes, so source extraction
	// must read the original URL. SVG rasterisation also needs the XML itself.
	if (forms.length === 1 && forms[0] === 'image' && !isSvgMime(info.mime)) {
		const thumburl = (info as ImageInfo & { thumburl?: string }).thumburl;
		return thumburl !== undefined && thumburl !== '' ? thumburl : info.url;
	}
	return info.url;
}
